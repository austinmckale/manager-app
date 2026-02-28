type JoistDocumentType = "estimate" | "invoice" | "document";

export type JoistDocumentExtract = {
  documentType: JoistDocumentType;
  documentNumber: string;
  customerName: string;
  address: string;
  scopeSummary: string;
  totalText: string;
  dateText: string;
  parseSource: "pdf_text" | "filename_fallback";
  parseError?: string;
  summary: string;
};

function firstRegexMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function parseContactBlockAddress(block: string) {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/.test(line))
    .filter((line) => !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(line));

  if (lines.length <= 1) return "";
  return lines.slice(1).join(", ").slice(0, 191);
}

function extractFromFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  const cleaned = lower.replace(/\.[a-z0-9]+$/, "");
  const estimateMatch = cleaned.match(/estimate[_\s-]?([a-z0-9-]+)/i);
  const invoiceMatch = cleaned.match(/invoice[_\s-]?([a-z0-9-]+)/i);

  if (estimateMatch?.[1]) {
    return { documentType: "estimate" as const, documentNumber: estimateMatch[1] };
  }
  if (invoiceMatch?.[1]) {
    return { documentType: "invoice" as const, documentNumber: invoiceMatch[1] };
  }
  return { documentType: "document" as const, documentNumber: "" };
}

function buildSummary(extract: Omit<JoistDocumentExtract, "summary">) {
  const parts: string[] = [];
  if (extract.documentType === "estimate") parts.push("Estimate");
  if (extract.documentType === "invoice") parts.push("Invoice");
  if (extract.documentNumber) parts.push(`#${extract.documentNumber}`);
  if (extract.customerName) parts.push(extract.customerName);
  if (extract.address) parts.push(extract.address);
  if (extract.totalText) parts.push(`$${extract.totalText}`);
  if (extract.scopeSummary) parts.push(extract.scopeSummary);

  const joined = parts.join(" · ").trim();
  if (joined) return joined.slice(0, 280);
  return "Joist document imported";
}

export function extractJoistDocumentFromText(text: string): JoistDocumentExtract {
  const normalized = text.replace(/\r/g, "\n");
  const estimateNumber = firstRegexMatch(normalized, [/Estimate\s*#\s*([A-Za-z0-9-]+)/i]);
  const invoiceNumber = firstRegexMatch(normalized, [/Invoice\s*#\s*([A-Za-z0-9-]+)/i]);
  const documentType: JoistDocumentType = estimateNumber ? "estimate" : invoiceNumber ? "invoice" : "document";
  const documentNumber = estimateNumber || invoiceNumber || "";

  const contactBlock = firstRegexMatch(normalized, [
    /Prepared For\s*\n([\s\S]{0,260}?)\nRHI SOLUTIONS/i,
    /Bill To\s*\n([\s\S]{0,260}?)\nRHI SOLUTIONS/i,
  ]);
  const customerName =
    firstRegexMatch(normalized, [/Prepared For\s*\n([^\n]+)/i, /Bill To\s*\n([^\n]+)/i]) ||
    contactBlock.split("\n")[0]?.trim() ||
    "";

  const serviceAddressBlock = firstRegexMatch(normalized, [/Service Address\s*\n([\s\S]{0,180}?)\nPrepared For/i]);
  const address = serviceAddressBlock
    ? serviceAddressBlock
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(", ")
        .slice(0, 191)
    : parseContactBlockAddress(contactBlock);

  const descriptionBlock = firstRegexMatch(normalized, [
    /Description(?:\s*Total)?\s*\n([\s\S]{0,260}?)\n(?:Scope of Work|Subtotal|Total|--)/i,
    /Description(?:\s*Total)?\s*\n([^\n]+(?:\n[^\n]+){0,2})/i,
  ]);
  const scopeSummary =
    descriptionBlock
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !/\$\s*\d/.test(line) && !/^total$/i.test(line)) || "";

  const totalText = firstRegexMatch(normalized, [/\bTotal\s*\$?\s*([0-9,]+\.\d{2})/i]);
  const dateText = firstRegexMatch(normalized, [/\bDate\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i]);

  const extract: Omit<JoistDocumentExtract, "summary"> = {
    documentType,
    documentNumber,
    customerName,
    address,
    scopeSummary,
    totalText,
    dateText,
    parseSource: "pdf_text",
  };

  return {
    ...extract,
    summary: buildSummary(extract),
  };
}

export function extractJoistDocumentFromFileName(fileName: string, parseError?: string): JoistDocumentExtract {
  const parsed = extractFromFileName(fileName);
  const extract: Omit<JoistDocumentExtract, "summary"> = {
    documentType: parsed.documentType,
    documentNumber: parsed.documentNumber,
    customerName: "",
    address: "",
    scopeSummary: "",
    totalText: "",
    dateText: "",
    parseSource: "filename_fallback",
    parseError,
  };
  return {
    ...extract,
    summary: buildSummary(extract),
  };
}

export function combineDescriptions(base: string | null | undefined, auto: string | null | undefined) {
  const baseText = (base ?? "").trim();
  const autoText = (auto ?? "").trim();
  if (baseText && autoText) {
    if (baseText.includes(autoText)) return baseText;
    return `${baseText} · ${autoText}`.slice(0, 320);
  }
  return (baseText || autoText || "").trim();
}
