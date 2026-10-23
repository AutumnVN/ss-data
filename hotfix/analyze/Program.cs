using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

var sourcePath = args.Length > 0 ? args[0] : "hotfix/out/Hotfix.cs";
var outputPath = args.Length > 1 ? args[1] : "hotfix.json";
var dataPath = args.Length > 2 ? args[2] : "EN";

var source = File.ReadAllText(sourcePath);
var root = CSharpSyntaxTree.ParseText(source, new CSharpParseOptions(LanguageVersion.Latest)).GetRoot();
var data = GameData.Load(dataPath);
var result = new HotfixAnalyzer(root, data).Analyze();

var classes = root.DescendantNodes().OfType<ClassDeclarationSyntax>().ToList();
var globalCollections = new Dictionary<string, List<string>>();

foreach (var cls in classes)
foreach (var (name, values) in GetCollections(cls))
    globalCollections[$"{cls.Identifier.Text}.{name}"] = values;

var collected = new List<Interaction>();
foreach (var cls in classes)
{
    var constants = GetConstants(cls);
    var collections = new Dictionary<string, List<string>>(globalCollections);
    foreach (var (name, values) in GetCollections(cls)) collections[name] = values;

    foreach (var method in cls.Members.OfType<MethodDeclarationSyntax>())
    {
        if (method.Body is null) continue;
        if (!method.DescendantNodes().OfType<InvocationExpressionSyntax>().Any(i =>
                i.Expression is MemberAccessExpressionSyntax member &&
                member.Name.Identifier.Text is "Shoot" or "PlayAreaEffect" or "AddBuff"
                    or "ModifyAreaEffectLeftTime" or "AddAreaEffectLeftTime")) continue;

        var collector = new Collector(cls.Identifier.Text, method, constants, collections, data);
        collector.Run();
        collected.AddRange(collector.Interactions);
    }
}

var interactions = PropagateCallSiteConditions(root, collected, data)
    .Where(interaction => interaction.Values.Any(value =>
        value.Conditions.Any(condition => IsKnownPerk(condition, data))))
    .GroupBy(interaction => JsonSerializer.Serialize(interaction))
    .Select(group => group.First())
    .OrderBy(i => i.Line)
    .ToList();

var output = new
{
    source = Path.GetFileName(sourcePath),
    hidden = result.Hidden,
    notes = result.Notes,
    interactions,
};

var directory = Path.GetDirectoryName(outputPath);
if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

File.WriteAllText(
    outputPath,
    JsonSerializer.Serialize(output, new JsonSerializerOptions
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    }) + "\n"
);

var hiddenCount = result.Hidden.Potential.Values.Sum(ids => ids.Count) +
                  result.Hidden.Character.Values.Sum(ids => ids.Count);
Console.WriteLine($"{hiddenCount} hidden id(s), {result.Notes.Count} note id(s), {interactions.Count} interaction(s) -> {outputPath}");

static Dictionary<string, string> GetConstants(ClassDeclarationSyntax cls)
{
    var constants = new Dictionary<string, string>();

    foreach (var field in cls.Members.OfType<FieldDeclarationSyntax>())
    {
        var isConstant = field.Modifiers.Any(SyntaxKind.ConstKeyword) ||
                         field.Modifiers.Any(SyntaxKind.ReadOnlyKeyword);
        var isFixedPoint = field.Declaration.Type.ToString() == "FP";

        foreach (var variable in field.Declaration.Variables)
        {
            var value = variable.Initializer?.Value;

            if (value is LiteralExpressionSyntax literal)
            {
                constants[variable.Identifier.Text] = literal.Token.ValueText;
                continue;
            }

            if (!isConstant && !isFixedPoint) continue;
            if (value is not InvocationExpressionSyntax invocation) continue;
            if (InvocationNameOf(invocation) != "op_Implicit") continue;
            if (invocation.ArgumentList.Arguments.Count != 1) continue;
            if (invocation.ArgumentList.Arguments[0].Expression is not LiteralExpressionSyntax argument) continue;

            constants[variable.Identifier.Text] = argument.Token.ValueText.TrimEnd('f', 'F', 'd', 'D', 'm', 'M');
        }
    }

    return constants;
}

static string? InvocationNameOf(InvocationExpressionSyntax invocation)
{
    return invocation.Expression switch
    {
        MemberAccessExpressionSyntax member => member.Name.Identifier.Text,
        IdentifierNameSyntax identifier => identifier.Identifier.Text,
        GenericNameSyntax generic => generic.Identifier.Text,
        _ => null,
    };
}

static Dictionary<string, List<string>> GetCollections(ClassDeclarationSyntax cls)
{
    var collections = new Dictionary<string, List<string>>();

    foreach (var field in cls.Members.OfType<FieldDeclarationSyntax>())
    {
        if (!field.Declaration.Type.ToString().Contains("string")) continue;

        foreach (var variable in field.Declaration.Variables)
        {
            var values = StringValues(variable.Initializer?.Value).ToList();
            if (values.Count > 0) collections[variable.Identifier.Text] = values;
        }
    }

    return collections;
}

static IEnumerable<string> StringValues(ExpressionSyntax? expression)
{
    if (expression is AssignmentExpressionSyntax assignment)
    {
        foreach (var value in StringValues(assignment.Right))
            yield return value;
    }
    else if (expression is ObjectCreationExpressionSyntax creation && creation.Initializer is not null)
    {
        foreach (var item in creation.Initializer.Expressions)
        foreach (var value in StringValues(item))
            yield return value;
    }
    else if (expression is ImplicitObjectCreationExpressionSyntax implicitCreation &&
             implicitCreation.Initializer is not null)
    {
        foreach (var item in implicitCreation.Initializer.Expressions)
        foreach (var value in StringValues(item))
            yield return value;
    }
    else if (expression is ArrayCreationExpressionSyntax array && array.Initializer is not null)
    {
        foreach (var item in array.Initializer.Expressions)
        foreach (var value in StringValues(item))
            yield return value;
    }
    else if (expression is ImplicitArrayCreationExpressionSyntax implicitArray)
    {
        foreach (var item in implicitArray.Initializer.Expressions)
        foreach (var value in StringValues(item))
            yield return value;
    }
    else if (expression is LiteralExpressionSyntax literal &&
             literal.IsKind(SyntaxKind.StringLiteralExpression))
    {
        yield return literal.Token.ValueText;
    }
}

static bool IsKnownPerk(Condition condition, GameData data)
{
    return condition.Type == "perk" && !condition.Negated && data.Potentials.ContainsKey(condition.Value);
}

static List<Interaction> PropagateCallSiteConditions(SyntaxNode root, List<Interaction> interactions, GameData data)
{
    var result = new List<Interaction>(interactions);

    foreach (var cls in root.DescendantNodes().OfType<ClassDeclarationSyntax>())
    {
        var constants = GetConstants(cls);
        var collections = GetCollections(cls);

        foreach (var method in cls.Members.OfType<MethodDeclarationSyntax>())
        {
            var (start, end) = MethodLines(method);
            var targets = interactions
                .Where(interaction => interaction.Method == method.Identifier.Text &&
                                      interaction.Line >= start && interaction.Line <= end &&
                                      !interaction.Values.Any(value => value.Conditions.Count > 0))
                .ToList();
            if (targets.Count == 0) continue;

            var sites = new List<(IdentifierNameSyntax Reference, List<Condition> Conditions)>();

            foreach (var reference in cls.DescendantNodes().OfType<IdentifierNameSyntax>())
            {
                if (reference.Identifier.Text != method.Identifier.Text) continue;

                var caller = reference.Ancestors().OfType<MethodDeclarationSyntax>().FirstOrDefault();
                if (caller is null || caller == method) continue;

                sites.Add((reference, GetCallSiteConditions(reference, caller, cls, constants, collections, data)));
            }

            if (sites.Count == 0 || sites.Any(site => !site.Conditions.Any(condition => IsKnownPerk(condition, data))))
                continue;

            foreach (var (_, conditions) in sites)
            {
                foreach (var target in targets)
                {
                    var values = target.Values
                        .Select(value => value with
                        {
                            Conditions = Collector.CombineConditions(value.Conditions, conditions),
                        })
                        .ToList();
                    result.Add(target with { Values = values });
                }
            }
        }
    }

    return result;
}

static List<Condition> GetCallSiteConditions(
    IdentifierNameSyntax reference,
    MethodDeclarationSyntax caller,
    ClassDeclarationSyntax cls,
    Dictionary<string, string> constants,
    Dictionary<string, List<string>> collections,
    GameData data)
{
    var collector = new Collector(cls.Identifier.Text, caller, constants, collections, data);
    var conditions = new List<Condition>();

    foreach (var ancestor in reference.Ancestors())
    {
        if (ancestor == caller) break;

        if (ancestor is IfStatementSyntax ifStatement)
        {
            if (ifStatement.Statement.FullSpan.Contains(reference.Span))
                conditions = Collector.CombineConditions(conditions, collector.Conditions(ifStatement.Condition));
            else if (ifStatement.Else is not null && ifStatement.Else.FullSpan.Contains(reference.Span))
                conditions = Collector.CombineConditions(conditions, collector.GuardedConditions(ifStatement.Condition));
        }
        else if (ancestor is ConditionalExpressionSyntax conditional)
        {
            if (conditional.WhenTrue.FullSpan.Contains(reference.Span))
                conditions = Collector.CombineConditions(conditions, collector.Conditions(conditional.Condition));
            else if (conditional.WhenFalse.FullSpan.Contains(reference.Span))
                conditions = Collector.CombineConditions(conditions, collector.GuardedConditions(conditional.Condition));
        }
    }

    return conditions;
}

static (int Start, int End) MethodLines(MethodDeclarationSyntax method)
{
    var span = method.GetLocation().GetLineSpan();
    return (span.StartLinePosition.Line + 1, span.EndLinePosition.Line + 1);
}

internal sealed record AnalysisResult(HiddenIds Hidden, Dictionary<string, List<string>> Notes);

internal sealed class HiddenIds
{
    public Dictionary<string, List<string>> Potential { get; } = new();
    public Dictionary<string, List<string>> Character { get; } = new();

    public void Add(string hitDamageId, string name, GameData data)
    {
        var charId = data.GetCharId(hitDamageId);
        if (charId is null) return;

        var suffix = PotentialSuffix.Match(name);
        if (suffix.Success &&
            int.TryParse(suffix.Groups[1].Value, out var index) &&
            data.PotentialByChar.TryGetValue($"{charId}_{index}", out var potentialId))
        {
            Add(Potential, potentialId.ToString(), hitDamageId);
            return;
        }

        Add(Character, charId, hitDamageId);
    }

    private static readonly Regex PotentialSuffix = new("_P(\\d+)$", RegexOptions.Compiled);

    private static void Add(Dictionary<string, List<string>> bucket, string key, string id)
    {
        var ids = bucket.TryGetValue(key, out var existing) ? existing : bucket[key] = new List<string>();
        if (!ids.Contains(id)) ids.Add(id);
    }
}

internal sealed record Interaction(
    string Class,
    string Method,
    int Line,
    string Sink,
    string Argument,
    IReadOnlyList<Value> Values,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Time = null
);

internal sealed record Value([property: JsonPropertyName("value")] string Text, IReadOnlyList<Condition> Conditions);

internal sealed record Condition(string Type, string Value, bool Negated);

internal sealed class GameData
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public HashSet<string> HitDamageIds { get; } = new();
    public HashSet<string> CharacterIds { get; } = new();
    public Dictionary<string, PotentialRecord> Potentials { get; } = new();
    public Dictionary<string, ItemRecord> Items { get; } = new();
    public Dictionary<string, string> LangItems { get; } = new();
    public Dictionary<string, int> PotentialByChar { get; } = new();
    public Dictionary<string, ScriptParameterRecord> ScriptParameters { get; } = new();
    public Dictionary<string, long> ScriptParameterValues { get; } = new();

    public static GameData Load(string dataPath)
    {
        var data = new GameData();
        var bin = Path.Combine(dataPath, "bin");

        foreach (var id in Read<Dictionary<string, JsonElement>>(Path.Combine(bin, "HitDamage.json")).Keys)
            data.HitDamageIds.Add(id);
        foreach (var id in Read<Dictionary<string, JsonElement>>(Path.Combine(bin, "Character.json")).Keys)
            data.CharacterIds.Add(id);
        foreach (var (id, potential) in Read<Dictionary<string, PotentialRecord>>(Path.Combine(bin, "Potential.json")))
            data.Potentials[id] = potential;
        foreach (var (id, item) in Read<Dictionary<string, ItemRecord>>(Path.Combine(bin, "Item.json")))
            data.Items[id] = item;
        foreach (var (key, value) in Read<Dictionary<string, string>>(Path.Combine(dataPath, "language", "en_US", "Item.json")))
            data.LangItems[key] = value;
        foreach (var (id, parameter) in Read<Dictionary<string, ScriptParameterRecord>>(Path.Combine(bin, "ScriptParameter.json")))
            data.ScriptParameters[id] = parameter;
        foreach (var (id, parameter) in Read<Dictionary<string, ScriptParameterValueRecord>>(Path.Combine(bin, "ScriptParameterValue.json")))
            if (parameter.CommonData is { } value) data.ScriptParameterValues[id] = value;

        foreach (var (_, potential) in data.Potentials)
            data.PotentialByChar[$"{potential.CharId}_{potential.Id % 100}"] = potential.Id;

        return data;
    }

    public string? ScriptValue(int id)
    {
        if (!ScriptParameters.TryGetValue(id.ToString(), out var parameter)) return null;
        if (parameter.LevelTypeData != 0) return null;
        if (!ScriptParameterValues.TryGetValue(id.ToString(), out var value)) return null;

        return (value / 10000m).ToString("0.####", CultureInfo.InvariantCulture);
    }

    public string? GetCharId(string hitDamageId)
    {
        if (hitDamageId.Length < 3) return null;
        var charId = hitDamageId[..3];
        return CharacterIds.Contains(charId) ? charId : null;
    }

    public string PotentialLabel(int potentialId)
    {
        if (!Potentials.TryGetValue(potentialId.ToString(), out var potential))
            return $"potential {potentialId}";

        if (Items.TryGetValue(potentialId.ToString(), out var item) &&
            item.Title is not null &&
            LangItems.TryGetValue(item.Title, out var name))
            return $"{name} ({potentialId})";

        return $"P{potential.Id % 100} ({potentialId})";
    }

    private static T Read<T>(string path)
    {
        return JsonSerializer.Deserialize<T>(File.ReadAllText(path), JsonOptions)
               ?? throw new InvalidDataException($"Could not read {path}");
    }

    internal sealed class PotentialRecord
    {
        public int Id { get; set; }
        public int CharId { get; set; }
    }

    internal sealed class ItemRecord
    {
        public string? Title { get; set; }
    }

    internal sealed class ScriptParameterRecord
    {
        public int Id { get; set; }
        public int LevelTypeData { get; set; }
    }

    internal sealed class ScriptParameterValueRecord
    {
        public int Id { get; set; }
        public long? CommonData { get; set; }
    }
}

internal sealed class HotfixAnalyzer
{
    private static readonly Regex HitDamageName = new("[hH]itDamage", RegexOptions.Compiled);
    private static readonly Regex NumericId = new("^\\d{7,9}$", RegexOptions.Compiled);

    private static readonly Dictionary<string, string> Elements = new()
    {
        ["WE"] = "Aqua",
        ["FE"] = "Ignis",
        ["SE"] = "Terra",
        ["AE"] = "Ventus",
        ["LE"] = "Lux",
        ["DE"] = "Umbra",
    };

    private static readonly Dictionary<int, string> ElementNames = new()
    {
        [1] = "Aqua",
        [2] = "Ignis",
        [3] = "Terra",
        [4] = "Ventus",
        [5] = "Lux",
        [6] = "Umbra",
    };

    private readonly SyntaxNode _root;
    private readonly GameData _data;
    private readonly Dictionary<(string Namespace, string Name), string> _damageTags = new();
    private readonly HashSet<string> _applyMethods = new();
    private readonly Dictionary<(string Namespace, string Name), MappingInfo> _mappings = new();
    private readonly List<MappingInfo> _mappingList = new();
    private readonly List<MappingUsage> _mappingUsages = new();
    private readonly Dictionary<string, List<Occurrence>> _occurrences = new();
    private readonly List<HiddenCandidate> _hiddenCandidates = new();

    public HotfixAnalyzer(SyntaxNode root, GameData data)
    {
        _root = root;
        _data = data;
    }

    public AnalysisResult Analyze()
    {
        CollectDamageTags();
        CollectApplyMethods();
        CollectMappings();
        CollectDeclarations();
        CollectOccurrences();
        CollectMappingUsages();

        return new AnalysisResult(BuildHidden(), BuildNotes());
    }

    private void CollectDamageTags()
    {
        foreach (var variable in _root.DescendantNodes().OfType<VariableDeclaratorSyntax>())
        {
            if (variable.Initializer?.Value is not InvocationExpressionSyntax invocation) continue;
            if (!IsNamed(invocation, "StringToHash")) continue;

            var text = StringArgument(invocation);
            if (text is null) continue;

            _damageTags[(GetNamespace(variable), variable.Identifier.Text)] = text;
        }

        foreach (var assignment in _root.DescendantNodes().OfType<AssignmentExpressionSyntax>())
        {
            var name = AssignedName(assignment.Left);
            if (name is null || assignment.Right is not InvocationExpressionSyntax invocation) continue;
            if (!IsNamed(invocation, "StringToHash")) continue;

            var text = StringArgument(invocation);
            if (text is null) continue;

            _damageTags[(GetNamespace(assignment), name)] = text;
        }
    }

    private void CollectApplyMethods()
    {
        foreach (var method in _root.DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (method.ParameterList.Parameters.Any(parameter =>
                    parameter.Identifier.Text == "hitDamageId" &&
                    parameter.Type?.ToString() is "int" or "System.Int32"))
                _applyMethods.Add(method.Identifier.Text);
        }
    }

    private void CollectMappings()
    {
        foreach (var variable in _root.DescendantNodes().OfType<VariableDeclaratorSyntax>())
        {
            var name = variable.Identifier.Text;
            if (!name.StartsWith("hitDamageIdMapping", StringComparison.Ordinal)) continue;
            if (variable.Initializer?.Value is not ObjectCreationExpressionSyntax creation) continue;
            if (creation.Initializer is null) continue;

            var entries = new List<(string From, string To)>();

            foreach (var expression in creation.Initializer.Expressions)
            {
                if (expression is not AssignmentExpressionSyntax assignment) continue;
                if (assignment.Left is not ImplicitElementAccessSyntax access) continue;
                if (access.ArgumentList.Arguments.Count != 1) continue;

                var from = IntValue(access.ArgumentList.Arguments[0].Expression);
                var to = IntValue(assignment.Right);
                if (from is null || to is null) continue;

                entries.Add((from.Value.ToString(), to.Value.ToString()));
            }

            if (entries.Count == 0) continue;

            var mapping = new MappingInfo(name, GetNamespace(variable), entries);
            _mappings[(mapping.Namespace, mapping.Name)] = mapping;
            _mappingList.Add(mapping);
        }
    }

    private void CollectDeclarations()
    {
        foreach (var variable in _root.DescendantNodes().OfType<VariableDeclaratorSyntax>())
        {
            if (!HitDamageName.IsMatch(variable.Identifier.Text)) continue;
            if (variable.Initializer?.Value is not LiteralExpressionSyntax literal) continue;
            if (!literal.IsKind(SyntaxKind.NumericLiteralExpression)) continue;

            var id = literal.Token.ValueText;
            if (!_data.HitDamageIds.Contains(id)) continue;

            _hiddenCandidates.Add(new HiddenCandidate(id, variable.Identifier.Text));
        }

        foreach (var assignment in _root.DescendantNodes().OfType<AssignmentExpressionSyntax>())
        {
            var name = AssignedName(assignment.Left);
            if (name is null || !HitDamageName.IsMatch(name)) continue;
            if (assignment.Right is not LiteralExpressionSyntax literal) continue;
            if (!literal.IsKind(SyntaxKind.NumericLiteralExpression)) continue;

            var id = literal.Token.ValueText;
            if (!_data.HitDamageIds.Contains(id)) continue;

            _hiddenCandidates.Add(new HiddenCandidate(id, name));
        }
    }

    private void CollectOccurrences()
    {
        foreach (var node in _root.DescendantNodes())
        {
            switch (node)
            {
                case VariableDeclaratorSyntax:
                    break;

                case AssignmentExpressionSyntax assignment:
                {
                    var name = AssignedName(assignment.Left);
                    if (name is null || !HitDamageName.IsMatch(name)) break;

                    var id = IntValue(assignment.Right);
                    if (id is null) break;

                    AddOccurrence(id.Value.ToString(), assignment);
                    break;
                }

                case InvocationExpressionSyntax invocation:
                {
                    if (!IsDamageApply(invocation)) break;

                    foreach (var id in NumericIds(invocation))
                        AddOccurrence(id, invocation);
                    break;
                }
            }
        }
    }

    private void CollectMappingUsages()
    {
        foreach (var invocation in _root.DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (!IsNamed(invocation, "TryGetValue")) continue;
            if (invocation.Expression is not MemberAccessExpressionSyntax member) continue;

            var name = member.Expression switch
            {
                MemberAccessExpressionSyntax mappingAccess => mappingAccess.Name.Identifier.Text,
                IdentifierNameSyntax mappingName => mappingName.Identifier.Text,
                _ => null,
            };

            if (name is null || !name.StartsWith("hitDamageIdMapping", StringComparison.Ordinal)) continue;

            var mappingKey = (GetNamespace(invocation), name);
            if (!_mappings.TryGetValue(mappingKey, out var mapping)) continue;

            _mappingUsages.Add(new MappingUsage(mapping, GetMappingConditions(invocation)));
        }
    }

    private List<string> GetMappingConditions(InvocationExpressionSyntax invocation)
    {
        var conditions = new List<string>();

        foreach (var ifStatement in invocation.Ancestors().OfType<IfStatementSyntax>())
        {
            if (ifStatement.Else is not null && ifStatement.Else.Span.Contains(invocation.Span)) continue;
            if (!ifStatement.Condition.Span.Contains(invocation.Span) &&
                !ifStatement.Statement.Span.Contains(invocation.Span)) continue;

            AddCondition(ifStatement.Condition, conditions, filterPotentials: false);
        }

        var method = invocation.Ancestors().OfType<MethodDeclarationSyntax>().FirstOrDefault();
        if (method?.Identifier.Text == "OnReceiveNoDamage" && !conditions.Contains("hit deals no damage"))
            conditions.Add("hit deals no damage");

        return conditions;
    }

    private void AddCondition(SyntaxNode condition, List<string> conditions, bool filterPotentials)
    {
        foreach (var invocation in condition.DescendantNodesAndSelf().OfType<InvocationExpressionSyntax>())
        {
            var name = InvocationName(invocation);

            if (name == "HavePersonalPerk" && !IsNegated(invocation))
            {
                var perkId = PerkArgument(invocation);
                if (perkId is null) continue;
                if (filterPotentials && !_data.Potentials.ContainsKey(perkId.Value.ToString())) continue;

                var note = $"{_data.PotentialLabel(perkId.Value)} is active";
                if (!conditions.Contains(note)) conditions.Add(note);
                continue;
            }

            if (name == "CheckAllPlayerActorAreSameElement")
            {
                var element = invocation.ArgumentList.Arguments.Count > 0
                    ? ElementName(invocation.ArgumentList.Arguments[0].Expression)
                    : null;
                if (element is null) continue;

                var note = $"all party members are {element}";
                if (!conditions.Contains(note)) conditions.Add(note);
                continue;
            }

            if (name == "CheckHitByTag" && invocation.ArgumentList.Arguments.Count > 1)
            {
                var tagName = AssignedName(invocation.ArgumentList.Arguments[1].Expression);
                var tag = tagName is not null &&
                          _damageTags.TryGetValue((GetNamespace(invocation), tagName), out var value)
                    ? value
                    : "a specific damage tag";

                var note = $"hit has damage tag {tag}";
                if (!conditions.Contains(note)) conditions.Add(note);
                continue;
            }

            if (name == "IsPlayerSummoned" && !conditions.Contains("hit comes from your own summon"))
                conditions.Add("hit comes from your own summon");
        }
    }

    private HashSet<int> GetPerks(SyntaxNode node)
    {
        var perks = new HashSet<int>();

        foreach (var ancestor in node.Ancestors())
        {
            if (ancestor is IfStatementSyntax ifStatement)
            {
                if (ifStatement.Else is not null && ifStatement.Else.Span.Contains(node.Span)) continue;
                if (!ifStatement.Condition.Span.Contains(node.Span) &&
                    !ifStatement.Statement.Span.Contains(node.Span)) continue;

                AddPerkConditions(ifStatement.Condition, perks, negated: false);
                continue;
            }

            if (ancestor is not BlockSyntax block) continue;

            var childStatement = block.Statements.FirstOrDefault(statement => statement.Span.Contains(node.Span));
            if (childStatement is null) continue;

            foreach (var statement in block.Statements)
            {
                if (statement == childStatement) break;
                if (statement is not IfStatementSyntax earlyReturn || !Returns(earlyReturn.Statement)) continue;

                AddPerkConditions(earlyReturn.Condition, perks, negated: true);
            }
        }

        return perks;
    }

    private void AddPerkConditions(SyntaxNode condition, HashSet<int> perks, bool negated)
    {
        foreach (var invocation in condition.DescendantNodesAndSelf().OfType<InvocationExpressionSyntax>())
        {
            if (InvocationName(invocation) != "HavePersonalPerk") continue;
            if (IsNegated(invocation) != negated) continue;

            var perkId = PerkArgument(invocation);
            if (perkId is null || !_data.Potentials.ContainsKey(perkId.Value.ToString())) continue;

            perks.Add(perkId.Value);
        }
    }

    private void AddOccurrence(string id, SyntaxNode node)
    {
        if (!_data.HitDamageIds.Contains(id)) return;

        var line = node.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
        var perks = GetPerks(node);
        var list = _occurrences.TryGetValue(id, out var existing) ? existing : _occurrences[id] = new List<Occurrence>();

        if (list.Any(other => other.Line == line && other.Perks.SetEquals(perks))) return;
        list.Add(new Occurrence(line, perks));
    }

    private HiddenIds BuildHidden()
    {
        var hidden = new HiddenIds();

        foreach (var candidate in _hiddenCandidates)
            hidden.Add(candidate.Id, candidate.Name, _data);

        foreach (var mapping in _mappingList)
        {
            foreach (var entry in mapping.Entries)
                hidden.Add(entry.To, mapping.Name, _data);
        }

        return hidden;
    }

    private Dictionary<string, List<string>> BuildNotes()
    {
        var notes = new Dictionary<string, List<string>>();

        void Add(string id, string note)
        {
            if (!_data.HitDamageIds.Contains(id)) return;

            var list = notes.TryGetValue(id, out var existing) ? existing : notes[id] = new List<string>();
            if (!list.Contains(note)) list.Add(note);
        }

        foreach (var usage in _mappingUsages)
        {
            var when = usage.Conditions.Count == 0
                ? string.Empty
                : $" when: {JoinList(usage.Conditions)}";

            foreach (var entry in usage.Mapping.Entries)
            {
                Add(entry.To, $"Replaces {entry.From}{when}");
                Add(entry.From, $"Replaced by {entry.To}{when}");
            }
        }

        foreach (var (id, occurrences) in _occurrences)
        {
            var paths = occurrences.Select(occurrence => occurrence.Perks).ToList();

            if (paths.Count == 0 || paths.Any(perks => perks.Count == 0)) continue;

            var required = new HashSet<int>(paths[0]);
            foreach (var perks in paths.Skip(1)) required.IntersectWith(perks);
            if (required.Count == 0) continue;

            var labels = required
                .OrderBy(id => id)
                .Select(id => _data.PotentialLabel(id))
                .ToList();

            Add(id, $"Conditional hit damage: only when {JoinList(labels)} {(labels.Count == 1 ? "is" : "are")} active");
        }

        return notes
            .OrderBy(entry => long.TryParse(entry.Key, out var id) ? id : long.MaxValue)
            .ToDictionary(entry => entry.Key, entry => entry.Value);
    }

    private static string JoinList(IReadOnlyList<string> items)
    {
        if (items.Count == 0) return string.Empty;
        if (items.Count == 1) return items[0];
        if (items.Count == 2) return $"{items[0]} and {items[1]}";

        return $"{string.Join(", ", items.Take(items.Count - 1))}, and {items[^1]}";
    }

    private bool IsDamageApply(InvocationExpressionSyntax invocation)
    {
        var name = InvocationName(invocation);
        if (name is null) return false;

        return name == "HitActor" ||
               name.Contains("AreaHit", StringComparison.Ordinal) ||
               name is "FanDamage" or "RectangleDamage" or "GenerateIceFlower" ||
               _applyMethods.Contains(name);
    }

    private IEnumerable<string> NumericIds(SyntaxNode node)
    {
        foreach (var literal in node.DescendantNodesAndSelf().OfType<LiteralExpressionSyntax>())
        {
            if (!literal.IsKind(SyntaxKind.NumericLiteralExpression)) continue;

            var id = literal.Token.ValueText;
            if (NumericId.IsMatch(id) && _data.HitDamageIds.Contains(id))
                yield return id;
        }
    }

    private int? IntValue(ExpressionSyntax expression)
    {
        if (expression is LiteralExpressionSyntax literal &&
            literal.IsKind(SyntaxKind.NumericLiteralExpression))
            return Convert.ToInt32(literal.Token.Value);

        return null;
    }

    private static int? PerkArgument(InvocationExpressionSyntax invocation)
    {
        foreach (var argument in invocation.ArgumentList.Arguments)
        {
            if (argument.Expression is not LiteralExpressionSyntax literal) continue;
            if (!literal.IsKind(SyntaxKind.NumericLiteralExpression)) continue;

            var value = Convert.ToInt32(literal.Token.Value);
            if (value is >= 100000 and <= 999999) return value;
        }

        return null;
    }

    private static string? ElementName(ExpressionSyntax expression)
    {
        if (expression is ParenthesizedExpressionSyntax parenthesized)
            return ElementName(parenthesized.Expression);

        if (expression is CastExpressionSyntax cast)
            return ElementName(cast.Expression);

        if (expression is MemberAccessExpressionSyntax member &&
            Elements.TryGetValue(member.Name.Identifier.Text, out var name))
            return name;

        if (expression is LiteralExpressionSyntax literal &&
            literal.IsKind(SyntaxKind.NumericLiteralExpression) &&
            ElementNames.TryGetValue(Convert.ToInt32(literal.Token.Value), out name))
            return name;

        return null;
    }

    private static string? StringArgument(InvocationExpressionSyntax invocation)
    {
        var argument = invocation.ArgumentList.Arguments.FirstOrDefault()?.Expression;
        return argument is LiteralExpressionSyntax literal ? literal.Token.ValueText : null;
    }

    private static string? AssignedName(ExpressionSyntax expression)
    {
        return expression switch
        {
            IdentifierNameSyntax identifier => identifier.Identifier.Text,
            MemberAccessExpressionSyntax member => member.Name.Identifier.Text,
            _ => null,
        };
    }

    private static string? InvocationName(InvocationExpressionSyntax invocation)
    {
        return invocation.Expression switch
        {
            MemberAccessExpressionSyntax member => member.Name.Identifier.Text,
            IdentifierNameSyntax identifier => identifier.Identifier.Text,
            GenericNameSyntax generic => generic.Identifier.Text,
            _ => null,
        };
    }

    private static bool IsNamed(InvocationExpressionSyntax invocation, string name)
    {
        return InvocationName(invocation) == name;
    }

    private static bool IsNegated(InvocationExpressionSyntax invocation)
    {
        return invocation.Parent is PrefixUnaryExpressionSyntax unary &&
               unary.IsKind(SyntaxKind.LogicalNotExpression);
    }

    private static string GetNamespace(SyntaxNode node)
    {
        return node.Ancestors().OfType<BaseNamespaceDeclarationSyntax>().FirstOrDefault()?.Name.ToString() ?? string.Empty;
    }

    private static IEnumerable<StatementSyntax> Body(StatementSyntax statement)
    {
        return statement is BlockSyntax block ? block.Statements : new[] { statement };
    }

    private static bool Returns(StatementSyntax statement)
    {
        return statement switch
        {
            ReturnStatementSyntax => true,
            ThrowStatementSyntax => true,
            BlockSyntax block when block.Statements.Count > 0 => Returns(block.Statements[^1]),
            _ => false,
        };
    }

    private sealed record MappingInfo(string Name, string Namespace, List<(string From, string To)> Entries);

    private sealed record MappingUsage(MappingInfo Mapping, List<string> Conditions);

    private sealed record Occurrence(int Line, HashSet<int> Perks);

    private sealed record HiddenCandidate(string Id, string Name);
}

internal sealed class Collector
{
    private readonly string _class;
    private readonly MethodDeclarationSyntax _method;
    private readonly Dictionary<string, string> _constants;
    private readonly Dictionary<string, List<string>> _collections;
    private readonly GameData _data;
    private readonly Dictionary<string, List<Value>> _env = new();
    private readonly Dictionary<string, List<Value>> _areas = new();

    public Collector(
        string cls,
        MethodDeclarationSyntax method,
        Dictionary<string, string> constants,
        Dictionary<string, List<string>> collections,
        GameData data)
    {
        _class = cls;
        _method = method;
        _constants = constants;
        _collections = collections;
        _data = data;
    }

    public List<Interaction> Interactions { get; } = new();

    public void Run()
    {
        if (_method.Body is not null) Walk(_method.Body.Statements, _env, new List<Condition>());
    }

    public List<Condition> Conditions(ExpressionSyntax expression) => ParseCondition(expression);

    public List<Condition> GuardedConditions(ExpressionSyntax expression) => GuardConditions(expression);

    public static List<Condition> CombineConditions(IEnumerable<Condition> left, IEnumerable<Condition> right)
        => Merge(left, right);

    private List<Condition> Walk(IEnumerable<StatementSyntax> statements, Dictionary<string, List<Value>> env, List<Condition> active)
    {
        foreach (var statement in statements)
        {
            switch (statement)
            {
                case ReturnStatementSyntax ret:
                    if (ret.Expression is not null) WalkExpression(ret.Expression, env, active);
                    return active;

                case ThrowStatementSyntax:
                    return active;

                case YieldStatementSyntax yieldReturn when yieldReturn.IsKind(SyntaxKind.YieldReturnStatement):
                    if (yieldReturn.Expression is not null) WalkExpression(yieldReturn.Expression, env, active);
                    break;

                case LocalDeclarationStatementSyntax local:
                    foreach (var variable in local.Declaration.Variables)
                    {
                        if (variable.Initializer is null) continue;
                        TrackArea(variable.Identifier.Text, variable.Initializer.Value, env, active);
                        var values = Eval(variable.Initializer.Value, env, active);
                        if (values.Count > 0) env[variable.Identifier.Text] = values;
                        WalkExpression(variable.Initializer.Value, env, active);
                    }
                    break;

                case ExpressionStatementSyntax expression:
                    WalkExpression(expression.Expression, env, active);
                    break;

                case IfStatementSyntax ifStatement:
                    active = WalkIf(ifStatement, env, active);
                    break;

                case BlockSyntax block:
                    active = Walk(block.Statements, env, active);
                    break;

                case ForStatementSyntax forStatement:
                    Walk(Body(forStatement.Statement), Clone(env), forStatement.Condition is null
                        ? active
                        : Merge(active, ParseCondition(forStatement.Condition)));
                    break;

                case ForEachStatementSyntax forEachStatement:
                    Walk(Body(forEachStatement.Statement), Clone(env), active);
                    break;

                case WhileStatementSyntax whileStatement:
                    Walk(Body(whileStatement.Statement), Clone(env), Merge(active, ParseCondition(whileStatement.Condition)));
                    break;

                case DoStatementSyntax doStatement:
                    Walk(Body(doStatement.Statement), Clone(env), active);
                    break;

                case SwitchStatementSyntax switchStatement:
                    foreach (var section in switchStatement.Sections)
                        Walk(section.Statements, Clone(env), active);
                    break;

                case TryStatementSyntax tryStatement:
                    Walk(tryStatement.Block.Statements, Clone(env), active);
                    foreach (var catchClause in tryStatement.Catches)
                        Walk(catchClause.Block.Statements, Clone(env), active);
                    if (tryStatement.Finally is not null)
                        Walk(tryStatement.Finally.Block.Statements, Clone(env), active);
                    break;

                case UsingStatementSyntax usingStatement:
                    Walk(Body(usingStatement.Statement), Clone(env), active);
                    break;

                case LockStatementSyntax lockStatement:
                    Walk(Body(lockStatement.Statement), Clone(env), active);
                    break;

                case FixedStatementSyntax fixedStatement:
                    Walk(Body(fixedStatement.Statement), Clone(env), active);
                    break;

                case UnsafeStatementSyntax unsafeStatement:
                    Walk(unsafeStatement.Block.Statements, Clone(env), active);
                    break;

                case CheckedStatementSyntax checkedStatement:
                    Walk(checkedStatement.Block.Statements, Clone(env), active);
                    break;

                case LocalFunctionStatementSyntax localFunction:
                    if (localFunction.Body is not null)
                        Walk(localFunction.Body.Statements, Clone(env), active);
                    break;
            }
        }

        return active;
    }

    private List<Condition> WalkIf(IfStatementSyntax ifStatement, Dictionary<string, List<Value>> env, List<Condition> active)
    {
        var condition = ParseCondition(ifStatement.Condition);
        var before = Clone(env);

        var thenEnv = Clone(before);
        Walk(Body(ifStatement.Statement), thenEnv, Merge(active, condition));

        if (Returns(ifStatement.Statement))
        {
            if (ifStatement.Else is not null)
            {
                var elseEnv = Clone(before);
                Walk(Body(ifStatement.Else.Statement), elseEnv, active);
                Merge(env, elseEnv);
            }

            return Merge(active, GuardConditions(ifStatement.Condition));
        }

        Merge(env, thenEnv);

        if (ifStatement.Else is not null)
        {
            var elseEnv = Clone(before);
            Walk(Body(ifStatement.Else.Statement), elseEnv, Merge(active, GuardConditions(ifStatement.Condition)));
            Merge(env, elseEnv);
        }

        return active;
    }

    private void WalkExpression(ExpressionSyntax expression, Dictionary<string, List<Value>> env, List<Condition> active)
    {
        if (expression is AssignmentExpressionSyntax assignment)
        {
            if (assignment.Left is IdentifierNameSyntax target)
            {
                TrackArea(target.Identifier.Text, assignment.Right, env, active);
                var values = Eval(assignment.Right, env, active);
                if (values.Count > 0) env[target.Identifier.Text] = values;
            }

            WalkExpression(assignment.Right, env, active);
            return;
        }

        if (expression is InvocationExpressionSyntax invocation)
        {
            EmitAliasSink(invocation, env, active);
            foreach (var argument in invocation.ArgumentList.Arguments)
                WalkExpression(argument.Expression, env, active);
            return;
        }

        if (expression is CastExpressionSyntax cast)
        {
            WalkExpression(cast.Expression, env, active);
            return;
        }

        if (expression is BinaryExpressionSyntax binary &&
            (binary.IsKind(SyntaxKind.AsExpression) || binary.IsKind(SyntaxKind.IsExpression)))
        {
            WalkExpression(binary.Left, env, active);
            return;
        }

        if (expression is ParenthesizedExpressionSyntax parenthesized)
        {
            WalkExpression(parenthesized.Expression, env, active);
            return;
        }

        if (expression is ConditionalExpressionSyntax conditional)
        {
            WalkExpression(conditional.WhenTrue, env, Merge(active, ParseCondition(conditional.Condition)));
            WalkExpression(conditional.WhenFalse, env, Merge(active, GuardConditions(conditional.Condition)));
            return;
        }

        if (expression is LambdaExpressionSyntax lambda)
        {
            if (lambda.Body is BlockSyntax block)
                Walk(block.Statements, Clone(env), active);
            else if (lambda.Body is ExpressionSyntax body)
                WalkExpression(body, env, active);
            return;
        }

        if (expression is AnonymousMethodExpressionSyntax anonymous)
        {
            Walk(anonymous.Block.Statements, Clone(env), active);
            return;
        }

        if (expression is AwaitExpressionSyntax awaitExpression)
            WalkExpression(awaitExpression.Expression, env, active);
    }

    private void EmitAliasSink(InvocationExpressionSyntax invocation, Dictionary<string, List<Value>> env, List<Condition> active)
    {
        var arguments = invocation.ArgumentList.Arguments;
        var line = invocation.GetLocation().GetLineSpan().StartLinePosition.Line + 1;

        if ((IsNamed(invocation, "ModifyAreaEffectLeftTime") || IsNamed(invocation, "AddAreaEffectLeftTime")) &&
            arguments.Count > 1 &&
            arguments[0].Expression is IdentifierNameSyntax area &&
            _areas.TryGetValue(area.Identifier.Text, out var areas) &&
            areas.Count > 0)
        {
            var time = arguments[1].Expression;
            var areaValues = Dedupe(areas
                .Select(value => value with { Conditions = active })
                .ToList());

            Interactions.Add(new Interaction(
                _class,
                _method.Identifier.Text,
                line,
                InvocationName(invocation)!,
                time.ToString(),
                areaValues,
                ResolveTime(time)
            ));

            return;
        }

        string? sink = null;
        ExpressionSyntax? alias = null;

        if (IsNamed(invocation, "Shoot") && arguments.Count > 0)
        {
            sink = "Shoot";
            alias = arguments[0].Expression;
        }
        else if (IsNamed(invocation, "PlayAreaEffect"))
        {
            sink = "PlayAreaEffect";
            alias = AreaEffectAlias(invocation);
        }
        else if (IsNamed(invocation, "AddBuff") && arguments.Count > 0)
        {
            sink = "AddBuff";
            alias = arguments[0].Expression;
        }

        if (sink is null || alias is null) return;

        var values = Dedupe(Eval(alias, env, active));
        if (values.Count == 0) return;

        Interactions.Add(new Interaction(
            _class,
            _method.Identifier.Text,
            line,
            sink,
            alias.ToString(),
            values
        ));
    }

    private static ExpressionSyntax? AreaEffectAlias(InvocationExpressionSyntax invocation)
    {
        var arguments = invocation.ArgumentList.Arguments;

        return arguments.FirstOrDefault(argument =>
                argument.NameColon?.Name.Identifier.Text is "alias" or "areaEffect" or "areaEffectAlias" or "fxAlias")
            ?.Expression
            ?? (arguments.Count > 1 ? arguments[1].Expression : null);
    }

    private void TrackArea(string name, ExpressionSyntax expression, Dictionary<string, List<Value>> env, List<Condition> active)
    {
        if (expression is not InvocationExpressionSyntax invocation) return;
        if (!IsNamed(invocation, "PlayAreaEffect")) return;

        var alias = AreaEffectAlias(invocation);
        if (alias is null) return;

        var values = Dedupe(Eval(alias, env, active))
            .Where(value => value.Text.Length > 0)
            .ToList();
        if (values.Count > 0) _areas[name] = values;
    }

    private string? ResolveTime(ExpressionSyntax expression)
    {
        if (expression is InvocationExpressionSyntax invocation &&
            InvocationName(invocation) == "op_Implicit" &&
            invocation.ArgumentList.Arguments.Count == 1)
        {
            return ResolveTime(invocation.ArgumentList.Arguments[0].Expression);
        }

        if (expression is InvocationExpressionSyntax scriptValue &&
            InvocationName(scriptValue) == "GetScriptValue")
        {
            var id = scriptValue.ArgumentList.Arguments
                .Select(argument => argument.Expression)
                .OfType<LiteralExpressionSyntax>()
                .Where(literal => literal.IsKind(SyntaxKind.NumericLiteralExpression))
                .Select(literal => (int?)Convert.ToInt32(literal.Token.Value))
                .FirstOrDefault(value => value is not null);

            return id is null ? null : _data.ScriptValue(id.Value);
        }

        if (expression is LiteralExpressionSyntax literal)
        {
            return literal.Token.ValueText.TrimEnd('f', 'F', 'd', 'D', 'm', 'M');
        }

        var name = expression switch
        {
            IdentifierNameSyntax identifier => identifier.Identifier.Text,
            MemberAccessExpressionSyntax member => member.Name.Identifier.Text,
            _ => null,
        };

        return name is not null && _constants.TryGetValue(name, out var value) ? value : null;
    }

    private List<Value> Eval(ExpressionSyntax expression, Dictionary<string, List<Value>> env, List<Condition> active)
    {
        switch (expression)
        {
            case LiteralExpressionSyntax literal:
                return new List<Value> { new(literal.Token.ValueText, active) };

            case ParenthesizedExpressionSyntax parenthesized:
                return Eval(parenthesized.Expression, env, active);

            case ConditionalExpressionSyntax conditional:
                return Dedupe(
                    Eval(conditional.WhenTrue, env, Merge(active, ParseCondition(conditional.Condition)))
                        .Concat(Eval(conditional.WhenFalse, env, Merge(active, GuardConditions(conditional.Condition))))
                );

            case ElementAccessExpressionSyntax element:
                if (CollectionName(element.Expression) is { } collection &&
                    _collections.TryGetValue(collection, out var items))
                {
                    return items.Select(item => new Value(item, active)).ToList();
                }

                return new List<Value>();

            case IdentifierNameSyntax identifier:
                if (env.TryGetValue(identifier.Identifier.Text, out var values))
                {
                    return values
                        .Select(value => value with { Conditions = Merge(value.Conditions, active) })
                        .ToList();
                }

                if (_constants.TryGetValue(identifier.Identifier.Text, out var constant))
                {
                    return new List<Value> { new(constant, active) };
                }

                return new List<Value>();

            case MemberAccessExpressionSyntax member:
                if (_constants.TryGetValue(member.Name.Identifier.Text, out var memberConstant))
                {
                    return new List<Value> { new(memberConstant, active) };
                }

                return new List<Value>();

            default:
                return new List<Value>();
        }
    }

    private static string? CollectionName(ExpressionSyntax expression)
    {
        return expression switch
        {
            IdentifierNameSyntax identifier => identifier.Identifier.Text,
            MemberAccessExpressionSyntax member => $"{member.Expression}.{member.Name.Identifier.Text}",
            _ => null,
        };
    }

    private List<Condition> ParseCondition(ExpressionSyntax expression, bool negated = false)
    {
        switch (expression)
        {
            case ParenthesizedExpressionSyntax parenthesized:
                return ParseCondition(parenthesized.Expression, negated);

            case PrefixUnaryExpressionSyntax unary when unary.IsKind(SyntaxKind.LogicalNotExpression):
                return ParseCondition(unary.Operand, !negated);

            case BinaryExpressionSyntax binary when binary.IsKind(SyntaxKind.LogicalAndExpression) && !negated:
                return Merge(ParseCondition(binary.Left), ParseCondition(binary.Right));

            case InvocationExpressionSyntax invocation:
                return ParsePerk(invocation, negated);

            case BinaryExpressionSyntax comparison:
                return ParseComparison(comparison, negated);

            default:
                return new List<Condition>();
        }
    }

    private List<Condition> GuardConditions(ExpressionSyntax expression)
    {
        switch (expression)
        {
            case ParenthesizedExpressionSyntax parenthesized:
                return GuardConditions(parenthesized.Expression);

            case PrefixUnaryExpressionSyntax unary when unary.IsKind(SyntaxKind.LogicalNotExpression):
                return ParseCondition(unary.Operand);

            case BinaryExpressionSyntax binary when binary.IsKind(SyntaxKind.LogicalOrExpression):
                return Merge(GuardConditions(binary.Left), GuardConditions(binary.Right));

            case InvocationExpressionSyntax invocation:
                return ParsePerk(invocation, negated: true);

            case BinaryExpressionSyntax comparison:
                return ParseComparison(comparison, negated: true);

            default:
                return new List<Condition>();
        }
    }

    private List<Condition> ParsePerk(InvocationExpressionSyntax invocation, bool negated)
    {
        var name = InvocationName(invocation);

        var arguments = invocation.ArgumentList.Arguments;
        var argument = name switch
        {
            "HavePersonalPerk" when arguments.Count > 1 => arguments[1].Expression,
            "GetPerk" when arguments.Count > 0 => arguments[0].Expression,
            "GetPerkLv" when arguments.Count > 0 => arguments[0].Expression,
            "GetPerkLevel" when arguments.Count > 0 => arguments[0].Expression,
            "GetPersonalPerkLevel" when arguments.Count > 1 => arguments[1].Expression,
            _ => null,
        };

        var perkId = argument is null ? null : ResolveInt(argument);
        if (perkId is null) return new List<Condition>();

        return new List<Condition> { new("perk", perkId.Value.ToString(), negated) };
    }

    private List<Condition> ParseComparison(BinaryExpressionSyntax comparison, bool negated)
    {
        var equals = comparison.IsKind(SyntaxKind.EqualsExpression);
        var notEquals = comparison.IsKind(SyntaxKind.NotEqualsExpression);
        if (!equals && !notEquals) return new List<Condition>();

        var name = comparison.Right switch
        {
            MemberAccessExpressionSyntax member => member.Name.Identifier.Text,
            IdentifierNameSyntax identifier => identifier.Identifier.Text,
            _ => null,
        };

        if (name is null) return new List<Condition>();

        var type = name switch
        {
            "LE" or "DE" or "FE" or "AQ" or "TE" or "GE" or "WL" => "element",
            "SKILL" or "NORMAL" or "ULTIMATE" or "PASSIVE" => "damageType",
            _ => null,
        };

        if (type is null) return new List<Condition>();

        return new List<Condition> { new(type, name, negated ^ notEquals) };
    }

    private int? ResolveInt(ExpressionSyntax expression)
    {
        switch (expression)
        {
            case LiteralExpressionSyntax literal when literal.IsKind(SyntaxKind.NumericLiteralExpression):
                return Convert.ToInt32(literal.Token.Value);

            case IdentifierNameSyntax identifier when _constants.TryGetValue(identifier.Identifier.Text, out var value) && int.TryParse(value, out var number):
                return number;

            case MemberAccessExpressionSyntax member when _constants.TryGetValue(member.Name.Identifier.Text, out var memberValue) && int.TryParse(memberValue, out var memberNumber):
                return memberNumber;

            default:
                return null;
        }
    }

    private static string? InvocationName(InvocationExpressionSyntax invocation)
    {
        return invocation.Expression switch
        {
            MemberAccessExpressionSyntax member => member.Name.Identifier.Text,
            IdentifierNameSyntax identifier => identifier.Identifier.Text,
            GenericNameSyntax generic => generic.Identifier.Text,
            _ => null,
        };
    }

    private static bool IsNamed(InvocationExpressionSyntax invocation, string name)
    {
        return InvocationName(invocation) == name;
    }

    private static IEnumerable<StatementSyntax> Body(StatementSyntax statement)
    {
        return statement is BlockSyntax block ? block.Statements : new[] { statement };
    }

    private static bool Returns(StatementSyntax statement)
    {
        return statement switch
        {
            ReturnStatementSyntax => true,
            ThrowStatementSyntax => true,
            BlockSyntax block when block.Statements.Count > 0 => Returns(block.Statements[^1]),
            _ => false,
        };
    }

    private static Dictionary<string, List<Value>> Clone(Dictionary<string, List<Value>> env)
    {
        return env.ToDictionary(
            entry => entry.Key,
            entry => entry.Value
                .Select(value => value with { Conditions = value.Conditions.ToList() })
                .ToList()
        );
    }

    private static void Merge(Dictionary<string, List<Value>> target, Dictionary<string, List<Value>> source)
    {
        foreach (var (name, values) in source)
        {
            if (!target.TryGetValue(name, out var existing))
            {
                target[name] = values.Select(value => value with { Conditions = value.Conditions.ToList() }).ToList();
                continue;
            }

            foreach (var value in values)
            {
                if (existing.Any(other => SameValue(other, value))) continue;
                existing.Add(value with { Conditions = value.Conditions.ToList() });
            }
        }
    }

    private static List<Condition> Merge(IEnumerable<Condition> left, IEnumerable<Condition> right)
    {
        var result = left.ToList();

        foreach (var condition in right)
        {
            if (result.Any(other => SameCondition(other, condition))) continue;
            result.Add(condition);
        }

        return result;
    }

    private static List<Value> Dedupe(IEnumerable<Value> values)
    {
        var result = new List<Value>();

        foreach (var value in values)
        {
            if (result.Any(other => SameValue(other, value))) continue;
            result.Add(value);
        }

        return result;
    }

    private static bool SameValue(Value left, Value right)
    {
        return left.Text == right.Text && left.Conditions.Count == right.Conditions.Count &&
               left.Conditions.All(condition => right.Conditions.Any(other => SameCondition(condition, other)));
    }

    private static bool SameCondition(Condition left, Condition right)
    {
        return left.Type == right.Type && left.Value == right.Value && left.Negated == right.Negated;
    }
}
