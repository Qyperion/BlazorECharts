using System.Collections.ObjectModel;
using System.Globalization;
using System.Reflection;
using System.Runtime.CompilerServices;

namespace BlazorECharts.Tests.Api;

/// <summary>Deterministic text form of the API an assembly exposes to other assemblies.</summary>
/// <remarks>Nullability is read from the compiler's metadata as declared, so <c>T</c> and <c>T?</c> stay distinct.</remarks>
internal static class PublicApiSnapshot
{
    private const BindingFlags Declared =
        BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

    private const string NullableAttribute = "System.Runtime.CompilerServices.NullableAttribute";
    private const string NullableContextAttribute = "System.Runtime.CompilerServices.NullableContextAttribute";
    private static readonly HashSet<string> KeptAttributes = ["Parameter", "CascadingParameter", "EditorRequired", "SupplyParameterFromQuery", "JSInvokable", "Obsolete", "EditorBrowsable", "JsonPropertyName", "Flags", "OverloadResolutionPriority"];
    private static readonly HashSet<string> KeptParameterAttributes = ["AllowNull", "DisallowNull", "MaybeNull", "NotNull", "MaybeNullWhen", "NotNullWhen", "NotNullIfNotNull"];

    private static readonly Dictionary<Type, string> Keywords = new()
    {
        [typeof(object)] = "object",
        [typeof(string)] = "string",
        [typeof(bool)] = "bool",
        [typeof(byte)] = "byte",
        [typeof(sbyte)] = "sbyte",
        [typeof(char)] = "char",
        [typeof(decimal)] = "decimal",
        [typeof(double)] = "double",
        [typeof(float)] = "float",
        [typeof(int)] = "int",
        [typeof(uint)] = "uint",
        [typeof(long)] = "long",
        [typeof(ulong)] = "ulong",
        [typeof(short)] = "short",
        [typeof(ushort)] = "ushort",
        [typeof(void)] = "void",
        [typeof(nint)] = "nint",
        [typeof(nuint)] = "nuint",
    };

    public static string Render(Assembly assembly) =>
        string.Join("\n", assembly.GetExportedTypes().OrderBy(FullName, StringComparer.Ordinal).Select(RenderType)) + "\n";

    public static string RenderType(Type type)
    {
        if (type.IsSubclassOf(typeof(MulticastDelegate)))
        {
            var invoke = type.GetMethod("Invoke")!;
            return $"{Attributes(type)}public delegate {TypeRef(invoke.ReturnType, Annotations.Of(invoke.ReturnParameter))} {FullName(type)}{GenericParameters(type.GetGenericArguments())}({Parameters(invoke)}){Constraints(type.GetGenericArguments())}";
        }

        var members = type.GetMembers(Declared).Select(m => Member(type, m)).OfType<string>().Order(StringComparer.Ordinal).Select(m => "  " + m);
        return string.Join("\n", members.Prepend(Header(type)));
    }

    /// <summary>Prefixes each member with its type header, so a set difference names the owning type.</summary>
    public static string[] Qualify(string snapshot)
    {
        var lines = new List<string>();
        var header = "";
        foreach (var line in snapshot.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            if (line.StartsWith("  ", StringComparison.Ordinal))
                lines.Add(header + " :: " + line.Trim());
            else
                lines.Add(header = line);
        }

        return [.. lines];
    }

    private static string Header(Type type)
    {
        var record = type.GetMethod("PrintMembers", Declared, [typeof(System.Text.StringBuilder)])?.IsDefined(typeof(CompilerGeneratedAttribute)) == true;
        var kind = type.IsEnum
            ? "enum"
            : type.IsInterface ? "interface" : type.IsValueType ? record ? "record struct" : "struct" : record ? "record class" : "class";
        var modifiers = new List<string>();
        if (type.IsValueType && !type.IsEnum)
        {
            if (type.IsDefined(typeof(IsReadOnlyAttribute)))
                modifiers.Add("readonly");

            if (type.IsByRefLike)
                modifiers.Add("ref");
        }
        else if (!type.IsInterface && !type.IsEnum)
        {
            if (type.IsAbstract && type.IsSealed)
                modifiers.Add("static");
            else if (type.IsAbstract)
                modifiers.Add("abstract");
            else if (type.IsSealed)
                modifiers.Add("sealed");
        }

        var bases = new List<string>();
        if (type.IsEnum)
            bases.Add(TypeRef(Enum.GetUnderlyingType(type), null));
        else
        {
            if (type.BaseType is { } baseType && baseType != typeof(object) && baseType != typeof(ValueType))
                bases.Add(TypeRef(baseType, null));

            var inherited = type.BaseType?.GetInterfaces() ?? [];
            bases.AddRange(
                type.GetInterfaces().Where(i => i.IsVisible && !inherited.Contains(i)).Select(i => TypeRef(i, null)).Order(StringComparer.Ordinal));
        }

        var arguments = type.GetGenericArguments();
        return $"{Attributes(type)}public {string.Join(" ", modifiers.Append(kind))} {FullName(type)}{GenericParameters(arguments)}"
            + (bases.Count > 0 ? " : " + string.Join(", ", bases) : "")
            + Constraints(arguments);
    }

    private static string? Member(Type owner, MemberInfo member) => member switch
    {
        ConstructorInfo c when !c.IsStatic && Visible(owner, c) => $"{Attributes(c)}{Access(c)}ctor({Parameters(c)})",
        MethodInfo m when Visible(owner, m) && (!m.IsSpecialName || m.Name.StartsWith("op_", StringComparison.Ordinal)) && !m.Name.StartsWith('<') =>
            $"{Attributes(m)}{Access(m)}{Modifiers(owner, m)}{TypeRef(m.ReturnType, Annotations.Of(m.ReturnParameter))} {m.Name}{GenericParameters(m.GetGenericArguments())}({Parameters(m)}){Constraints(m.GetGenericArguments())}",
        PropertyInfo p => Property(owner, p),
        FieldInfo f when !f.IsSpecialName && Visible(owner, f) => Field(owner, f),
        EventInfo e when e.AddMethod is { } add && Visible(owner, add) =>
            $"{Attributes(e)}{Access(add)}{Modifiers(owner, add)}event {TypeRef(e.EventHandlerType!, Annotations.Of(e))} {e.Name}",
        _ => null,
    };

    private static string? Property(Type owner, PropertyInfo property)
    {
        var get = property.GetMethod is { } g && Visible(owner, g) ? g : null;
        var set = property.SetMethod is { } s && Visible(owner, s) ? s : null;
        if (get is null && set is null)
            return null;

        var widest = new[] { get, set }.OfType<MethodInfo>().MaxBy(Rank)!;

        string Accessor(MethodInfo accessor, string name) => (Rank(accessor) < Rank(widest) ? Access(accessor) : "") + name + ";";

        var accessors = new List<string>();
        if (get is not null)
            accessors.Add(Accessor(get, "get"));

        if (set is not null)
            accessors.Add(Accessor(set, set.ReturnParameter.GetRequiredCustomModifiers().Contains(typeof(IsExternalInit)) ? "init" : "set"));

        var indexer = property.GetIndexParameters();
        var name = indexer.Length == 0 ? property.Name : $"this[{string.Join(", ", indexer.Select(p => Parameter(p, false)))}]";
        var required = property.IsDefined(typeof(RequiredMemberAttribute)) ? "required " : "";
        return $"{Attributes(property)}{Access(widest)}{Modifiers(owner, widest)}{required}{TypeRef(property.PropertyType, Annotations.Of(property))} {name} {{ {string.Join(" ", accessors)} }}";
    }

    private static string Field(Type owner, FieldInfo field)
    {
        if (owner.IsEnum)
            return $"{Attributes(field)}{field.Name} = {Convert.ToString(field.GetRawConstantValue(), CultureInfo.InvariantCulture)}";

        var type = TypeRef(field.FieldType, Annotations.Of(field));
        if (field.IsLiteral)
            return $"{Attributes(field)}{Access(field)}const {type} {field.Name} = {Literal(field.GetRawConstantValue(), field.FieldType)}";

        return $"{Attributes(field)}{Access(field)}{(field.IsStatic ? "static " : "")}{(field.IsInitOnly ? "readonly " : "")}{type} {field.Name}";
    }

    private static string Parameters(MethodBase method)
    {
        var extension = method.IsDefined(typeof(ExtensionAttribute));
        return string.Join(", ", method.GetParameters().Select((p, i) => Parameter(p, extension && i == 0)));
    }

    private static string Parameter(ParameterInfo parameter, bool extension)
    {
        var type = parameter.ParameterType;
        var prefix = Attributes(parameter.CustomAttributes, KeptParameterAttributes) + (extension ? "this " : "");
        if (type.IsByRef)
        {
            prefix += parameter.IsOut
                ? "out "
                : parameter.IsDefined(typeof(IsReadOnlyAttribute))
                    ? "in "
                    : parameter.IsDefined(typeof(RequiresLocationAttribute)) ? "ref readonly " : "ref ";
            type = type.GetElementType()!;
        }

        if (parameter.IsDefined(typeof(ParamArrayAttribute)))
            prefix += "params ";

        var text = $"{prefix}{TypeRef(type, Annotations.Of(parameter))} {parameter.Name}";
        return parameter.HasDefaultValue ? text + " = " + Literal(parameter.RawDefaultValue, type) : text;
    }

    private static string Literal(object? value, Type type)
    {
        var target = Nullable.GetUnderlyingType(type) ?? type;
        if (value is null || value == DBNull.Value || value == Missing.Value)
            return type.IsValueType && Nullable.GetUnderlyingType(type) is null ? "default" : "null";

        if (target.IsEnum)
        {
            var name = Enum.GetName(target, Enum.ToObject(target, value));
            return name is null
                ? $"({TypeRef(target, null)}){Convert.ToString(value, CultureInfo.InvariantCulture)}"
                : $"{TypeRef(target, null)}.{name}";
        }

        return value switch
        {
            string s => "\"" + s.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal) + "\"",
            bool b => b ? "true" : "false",
            char c => $"'{c}'",
            IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
            _ => value.ToString() ?? "",
        };
    }

    /// <summary>Renders a type reference, consuming nullable flags in the compiler's pre-order encoding.</summary>
    private static string TypeRef(Type type, Annotations? annotations)
    {
        if (type.IsByRef)
            return TypeRef(type.GetElementType()!, annotations);

        if (type.IsPointer)
            return TypeRef(type.GetElementType()!, annotations) + "*";

        if (type.IsArray)
        {
            var flag = annotations?.Next();
            return TypeRef(type.GetElementType()!, annotations) + "[" + new string(',', type.GetArrayRank() - 1) + "]" + Mark(flag);
        }

        if (Nullable.GetUnderlyingType(type) is { } underlying)
            return TypeRef(underlying, annotations) + "?";

        if (type.IsGenericParameter)
        {
            var valueType = type.GenericParameterAttributes.HasFlag(GenericParameterAttributes.NotNullableValueTypeConstraint);
            return type.Name + (valueType ? "" : Mark(annotations?.Next()));
        }

        if (Keywords.TryGetValue(type, out var keyword))
            return keyword + (type.IsValueType ? "" : Mark(annotations?.Next()));

        // Non-generic value types have no flag; generic value types have a placeholder before their arguments.
        var own = !type.IsValueType || type.IsGenericType ? annotations?.Next() : null;
        var name = ShortName(type);
        if (type.IsGenericType)
            name += "<" + string.Join(", ", type.GetGenericArguments().Select(a => TypeRef(a, annotations))) + ">";

        return name + (type.IsValueType ? "" : Mark(own));
    }

    private static string Mark(byte? flag) => flag == 2 ? "?" : "";

    private static string ShortName(Type type)
    {
        var name = type.Name.Split('`')[0];
        return type.DeclaringType is { } declaring && !type.IsGenericParameter ? ShortName(declaring) + "." + name : name;
    }

    private static string FullName(Type type) => (type.Namespace is { } ns ? ns + "." : "") + ShortName(type);

    private static string GenericParameters(Type[] arguments) =>
        arguments.Length == 0 ? "" : "<" + string.Join(", ", arguments.Select(a => a.Name)) + ">";

    private static string Constraints(Type[] arguments)
    {
        var clauses = new List<string>();
        foreach (var argument in arguments.Where(a => a.IsGenericParameter))
        {
            var flags = argument.GenericParameterAttributes;
            var annotation = Annotations.Of(argument).Next();
            var parts = new List<string>();
            if (flags.HasFlag(GenericParameterAttributes.ReferenceTypeConstraint))
                parts.Add(annotation == 2 ? "class?" : "class");

            var valueType = flags.HasFlag(GenericParameterAttributes.NotNullableValueTypeConstraint);
            if (valueType)
                parts.Add("struct");

            var types = argument.GetGenericParameterConstraints()
                .Where(c => c != typeof(ValueType))
                .Select(c => TypeRef(c, null))
                .Order(StringComparer.Ordinal)
                .ToArray();
            if (parts.Count == 0 && types.Length == 0 && annotation == 1)
                parts.Add("notnull");

            parts.AddRange(types);
            if (flags.HasFlag(GenericParameterAttributes.DefaultConstructorConstraint) && !valueType)
                parts.Add("new()");

            if (parts.Count > 0)
                clauses.Add($" where {argument.Name} : {string.Join(", ", parts)}");
        }

        return string.Concat(clauses);
    }

    private static string Modifiers(Type owner, MethodInfo method)
    {
        if (method.IsStatic)
            return "static ";

        if (owner.IsInterface)
            return "";

        if (method.IsAbstract)
            return "abstract ";

        if (!method.IsVirtual)
            return "";

        var overrides = method.GetBaseDefinition().DeclaringType != method.DeclaringType;
        if (method.IsFinal)
            return overrides ? "sealed override " : "";

        return overrides ? "override " : "virtual ";
    }

    private static int Rank(MethodBase method) => method.IsPublic ? 2 : 1;

    private static bool Visible(Type owner, MethodBase method) =>
        method.IsPublic || ((method.IsFamily || method.IsFamilyOrAssembly) && !owner.IsSealed);

    private static bool Visible(Type owner, FieldInfo field) => field.IsPublic || ((field.IsFamily || field.IsFamilyOrAssembly) && !owner.IsSealed);

    private static string Access(MethodBase method) => method.IsPublic ? "" : "protected ";

    private static string Access(FieldInfo field) => field.IsPublic ? "" : "protected ";

    private static string Attributes(MemberInfo member) => Attributes(member.CustomAttributes, KeptAttributes);

    private static string Attributes(IEnumerable<CustomAttributeData> attributes, HashSet<string> kept)
    {
        var data = attributes.ToArray();
        var featureGated = data.Any(a => a.AttributeType == typeof(CompilerFeatureRequiredAttribute));
        var rendered = data
            .Select(
                a => (Data: a, Name: a.AttributeType.Name.EndsWith("Attribute", StringComparison.Ordinal)
                    ? a.AttributeType.Name[..^"Attribute".Length]
                    : a.AttributeType.Name))
            .Where(a => kept.Contains(a.Name) && !(featureGated && a.Name == "Obsolete"))
            .Select(a => a.Data.ConstructorArguments.Count == 0
                ? $"[{a.Name}]"
                : $"[{a.Name}({string.Join(", ", a.Data.ConstructorArguments.Select(arg => Literal(arg.Value, arg.ArgumentType)))})]")
            .Order(StringComparer.Ordinal);
        return string.Concat(rendered.Select(a => a + " "));
    }

    /// <summary>The declared nullable flags of one signature position: 0 oblivious, 1 not annotated, 2 annotated.</summary>
    private sealed class Annotations(byte[]? flags, byte context)
    {
        private int _index;

        public static Annotations Of(ParameterInfo parameter) => new(Flags(parameter.CustomAttributes), Context(parameter.Member));

        public static Annotations Of(MemberInfo member) => new(Flags(member.CustomAttributes), Context(member.DeclaringType));

        public static Annotations Of(Type genericParameter) =>
            new(Flags(genericParameter.CustomAttributes), Context((MemberInfo?)genericParameter.DeclaringMethod ?? genericParameter.DeclaringType));

        public byte Next() => flags is null ? context : flags.Length == 1 ? flags[0] : _index < flags.Length ? flags[_index++] : context;

        private static byte[]? Flags(IEnumerable<CustomAttributeData> attributes)
        {
            var nullable = attributes.FirstOrDefault(a => a.AttributeType.FullName == NullableAttribute);
            return nullable?.ConstructorArguments[0].Value switch
            {
                byte single => [single],
                ReadOnlyCollection<CustomAttributeTypedArgument> many => [.. many.Select(a => (byte)a.Value!)],
                _ => null,
            };
        }

        private static byte Context(MemberInfo? member)
        {
            for (; member is not null; member = member.DeclaringType)
                if (member.CustomAttributes.FirstOrDefault(a => a.AttributeType.FullName == NullableContextAttribute) is { } context)
                    return (byte)context.ConstructorArguments[0].Value!;

            return 0;
        }
    }
}
