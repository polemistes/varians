/**
 * Fetching texts from CTS services (Scaife, Perseus) by URN.
 *
 * The CTS GetPassage reply wraps a TEI fragment in a CTS envelope; the
 * fragment is extracted and handed to the TEI importer as a TEI document.
 */

export interface CtsOptions {
  /** Base of the CTS API; Scaife's by default. */
  endpoint?: string;
  timeoutMs?: number;
}

const SCAIFE_CTS = 'https://scaife-cts.perseus.org/api/cts';

export function isCtsUrn(text: string): boolean {
  return /^urn:cts:[^:]+:[^:]+(:[^:]+)?(:[^:]+)?$/u.test(text.trim());
}

/** The raw CTS reply for a passage or a whole text. */
export async function fetchCtsPassage(urn: string, options: CtsOptions = {}): Promise<string> {
  const endpoint = options.endpoint ?? SCAIFE_CTS;
  const url = `${endpoint}?request=GetPassage&urn=${encodeURIComponent(urn.trim())}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/xml, text/xml' },
    });
    if (!response.ok)
      throw new Error(`CTS request failed: ${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The TEI inside a CTS reply, as a document the TEI importer reads: the
 * `<passage>` content wrapped in a TEI skeleton, with the URN recorded.
 * A reply that already is a TEI document is returned as it is.
 */
export function teiFromCtsReply(reply: string, urn: string): string {
  if (/<TEI[\s>]/u.test(reply) && !/<reply[\s>]/u.test(reply)) return reply;
  const passage = /<passage[^>]*>([\s\S]*?)<\/passage>/u.exec(reply);
  const body = passage ? passage[1]! : reply;
  const title = /<label[^>]*>([\s\S]*?)<\/label>/u.exec(reply)?.[1]?.trim() ?? urn;
  return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title>${escapeXml(title)}</title></titleStmt>
  <publicationStmt><p>Fetched from a CTS service: ${escapeXml(urn)}</p></publicationStmt>
  <sourceDesc><p>${escapeXml(urn)}</p></sourceDesc></fileDesc></teiHeader>
  <text><body>${body}</body></text>
</TEI>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
