/**
 * LLM-based metadata extraction with dynamic schema.
 * Ported from backend/app/services/metadata_service.py.
 */
import OpenAI from "openai";

const MAX_TEXT_CHARS = 8000;

export interface MetadataFieldDefinition {
  name: string;
  type: "string" | "list" | "enum" | "number" | "boolean";
  required: boolean;
  description: string;
  enumValues?: string[];
}

export const DEFAULT_METADATA_SCHEMA: MetadataFieldDefinition[] = [
  {
    name: "title",
    type: "string",
    required: true,
    description: "A concise, descriptive title for the document",
  },
  {
    name: "summary",
    type: "string",
    required: true,
    description: "A 1-3 sentence summary of the document content",
  },
  {
    name: "document_type",
    type: "enum",
    required: true,
    description: "The category of this document",
    enumValues: [
      "article",
      "tutorial",
      "reference",
      "notes",
      "report",
      "essay",
      "code",
      "other",
    ],
  },
  {
    name: "topics",
    type: "list",
    required: true,
    description: "3-7 key topics or themes covered in the document",
  },
  {
    name: "language",
    type: "string",
    required: true,
    description:
      "ISO 639-1 language code of the document (e.g. en, es, fr)",
  },
];

export interface MetadataExtractionOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  schema?: MetadataFieldDefinition[];
}

export async function extractMetadata(
  text: string,
  opts: MetadataExtractionOptions,
): Promise<Record<string, any>> {
  const schema =
    opts.schema && opts.schema.length > 0
      ? opts.schema
      : DEFAULT_METADATA_SCHEMA;

  if (!opts.apiKey) {
    return defaultsForSchema(schema);
  }

  const client = new OpenAI({
    apiKey: opts.apiKey,
    ...(opts.baseUrl && { baseURL: opts.baseUrl }),
  });

  const truncatedText = text.slice(0, MAX_TEXT_CHARS);
  const prompt = buildExtractionPrompt(schema);
  const jsonSchema = buildJsonSchema(schema);

  const response = await client.chat.completions.create({
    model: opts.model,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: truncatedText },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "document_metadata",
        strict: true,
        schema: jsonSchema,
      },
    },
    temperature: 0.0,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return defaultsForSchema(schema);
  }

  const raw = extractJsonFromText(content);
  return validateMetadata(raw, schema);
}

function buildExtractionPrompt(schema: MetadataFieldDefinition[]): string {
  const lines = [
    "Extract the following metadata fields from the document.\n",
  ];

  schema.forEach((field, i) => {
    let typeDesc: string = field.type;
    if (field.type === "enum" && field.enumValues) {
      typeDesc = `enum: ${field.enumValues.join(" | ")}`;
    } else if (field.type === "list") {
      typeDesc = "list of strings";
    }
    const required = field.required ? "required" : "optional";
    lines.push(
      `${i + 1}. ${field.name} (${typeDesc}, ${required}): ${field.description}`,
    );
  });

  lines.push(
    "\nRespond with ONLY a valid JSON object containing these keys. No markdown, no explanation, no code fences. Just the raw JSON object.",
  );
  return lines.join("\n");
}

function buildJsonSchema(
  schema: MetadataFieldDefinition[],
): Record<string, any> {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const field of schema) {
    let typeSchema: Record<string, any>;
    switch (field.type) {
      case "string":
        typeSchema = { type: "string" };
        break;
      case "number":
        typeSchema = { type: "number" };
        break;
      case "boolean":
        typeSchema = { type: "boolean" };
        break;
      case "list":
        typeSchema = { type: "array", items: { type: "string" } };
        break;
      case "enum":
        typeSchema = field.enumValues
          ? { type: "string", enum: field.enumValues }
          : { type: "string" };
        break;
      default:
        typeSchema = { type: "string" };
    }

    if (!field.required) {
      properties[field.name] = {
        anyOf: [typeSchema, { type: "null" }],
        description: field.description,
      };
    } else {
      properties[field.name] = {
        ...typeSchema,
        description: field.description,
      };
    }

    // Strict mode requires ALL properties in required array
    required.push(field.name);
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function extractJsonFromText(text: string): Record<string, any> {
  text = text.trim();

  try {
    return JSON.parse(text);
  } catch {
    // Continue to fallbacks
  }

  if (text.includes("```")) {
    const match = text.match(/```(?:json)?\s*\n?(.*?)\n?```/s);
    if (match) {
      try {
        return JSON.parse(match[1].trim());
      } catch {
        // Continue
      }
    }
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // Continue
    }
  }

  throw new Error(
    `Could not extract JSON from response: ${text.slice(0, 200)}`,
  );
}

function validateMetadata(
  data: Record<string, any>,
  schema: MetadataFieldDefinition[],
): Record<string, any> {
  const validated: Record<string, any> = {};

  for (const field of schema) {
    const value = data[field.name];

    if (value === null || value === undefined) {
      if (field.required) {
        validated[field.name] = defaultForField(field);
      }
      continue;
    }

    switch (field.type) {
      case "string":
        validated[field.name] = value ? String(value) : defaultForField(field);
        break;
      case "list":
        validated[field.name] = Array.isArray(value)
          ? value.map(String)
          : [String(value)];
        break;
      case "enum": {
        const strVal = String(value);
        if (field.enumValues && field.enumValues.includes(strVal)) {
          validated[field.name] = strVal;
        } else {
          validated[field.name] = field.enumValues?.[0] ?? "other";
        }
        break;
      }
      case "number": {
        const num = Number(value);
        validated[field.name] = isNaN(num) ? 0 : num;
        break;
      }
      case "boolean":
        validated[field.name] = Boolean(value);
        break;
    }
  }

  return validated;
}

function defaultForField(field: MetadataFieldDefinition): any {
  switch (field.type) {
    case "string":
      return "";
    case "list":
      return [];
    case "enum":
      return field.enumValues?.[0] ?? "other";
    case "number":
      return 0;
    case "boolean":
      return false;
    default:
      return null;
  }
}

function defaultsForSchema(
  schema: MetadataFieldDefinition[],
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const field of schema) {
    if (field.required) {
      result[field.name] = defaultForField(field);
    }
  }
  return result;
}
