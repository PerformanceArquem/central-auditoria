/**
 * Effective sections for the official Arquem email + PDF/XLSX packet.
 * Legacy records have NULL; all existing sections remain enabled.
 * Only explicit boolean false revokes a particular section.
 */
export const REPORT_SECTION_KEYS = ['daily_detail', 'customers', 'activities'] as const;
export type ReportSection = (typeof REPORT_SECTION_KEYS)[number];

export function reportSectionOn(
  recipient: {report_sections?: unknown},
  key: ReportSection
): boolean {
  const source = recipient.report_sections;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return true;
  return (source as Record<string, unknown>)[key] !== false;
}

export function reportSectionFlags(recipient: {report_sections?: unknown}) {
  return {
    daily_detail: reportSectionOn(recipient, 'daily_detail'),
    customers: reportSectionOn(recipient, 'customers'),
    activities: reportSectionOn(recipient, 'activities')
  };
}
