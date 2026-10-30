using System.Text.Json;

namespace BlazorECharts.Events;

/// <summary>A native ECharts string or object query, evaluated by its event processor.</summary>
public sealed class EventQuery
{
    private EventQuery(JsonElement value, int throttle = 0)
    {
        Json = value.Clone();
        ThrottleMilliseconds = throttle;
    }

    internal JsonElement Json { get; }
    internal int ThrottleMilliseconds { get; }

    /// <summary>Copies the query with an opt-in leading-edge throttle; intermediate events are dropped. Zero disables
    /// throttling.</summary>
    public EventQuery WithThrottle(TimeSpan interval)
    {
        if (interval < TimeSpan.Zero || interval.TotalMilliseconds > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(interval));

        return new(Json, (int)Math.Ceiling(interval.TotalMilliseconds));
    }

    /// <summary>Creates an unfiltered subscription with opt-in throttling.</summary>
    public static EventQuery Throttled(TimeSpan interval)
    {
        using var json = JsonDocument.Parse("null");
        return new EventQuery(json.RootElement).WithThrottle(interval);
    }

    /// <summary>Queries a component type such as series.bar.</summary>
    public static EventQuery Component(string type)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(type);
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
            writer.WriteStringValue(type);

        using var json = JsonDocument.Parse(stream.ToArray());
        return new(json.RootElement);
    }

    /// <summary>Creates a native object query. Component selectors become <c>{component}Index/Id/Name</c>; data
    /// selectors become <c>dataIndex</c>, <c>name</c> and <c>dataType</c>; <paramref name="element"/> matches a named
    /// custom series element.</summary>
    /// <remarks>ECharts compares each condition with strict equality, so component ids and names are strings.</remarks>
    public static EventQuery Select(
        string? component = null,
        int? index = null,
        string? id = null,
        string? name = null,
        int? dataIndex = null,
        string? dataName = null,
        string? dataType = null,
        string? element = null)
    {
        var selectsComponent = index.HasValue || id is not null || name is not null;
        if (component is not null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(component);
            if (component == "data")
                throw new ArgumentException("ECharts reserves the data prefix for data selectors; use dataIndex.", nameof(component));

            if (!selectsComponent)
                throw new ArgumentException(
                    "A component query requires an index, id or name; use Component for a type-only query.",
                    nameof(component));
        }
        else if (selectsComponent)
            throw new ArgumentException("Component selectors require a component main type.", nameof(component));

        if (!selectsComponent && dataIndex is null && dataName is null && dataType is null && element is null)
            throw new ArgumentException("An object query requires at least one condition.");

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            if (index.HasValue)
                writer.WriteNumber(component + "Index", index.Value);

            if (id is not null)
                writer.WriteString(component + "Id", id);

            if (name is not null)
                writer.WriteString(component + "Name", name);

            if (dataIndex.HasValue)
                writer.WriteNumber("dataIndex", dataIndex.Value);

            if (dataName is not null)
                writer.WriteString("name", dataName);

            if (dataType is not null)
                writer.WriteString("dataType", dataType);

            if (element is not null)
                writer.WriteString("element", element);

            writer.WriteEndObject();
        }

        using var json = JsonDocument.Parse(stream.ToArray());
        return new(json.RootElement);
    }

    /// <summary>Clones an object query, including component selectors and custom series element selectors.</summary>
    public static EventQuery FromJson(JsonElement query) =>
        query.ValueKind == JsonValueKind.Object ? new(query) : throw new ArgumentException("Expected an object query.", nameof(query));
}
