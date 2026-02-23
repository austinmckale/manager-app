import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

async function buildPdf(title: string, lines: string[]) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  page.drawText("FieldFlow Manager", { x: 40, y: 760, size: 12, font });
  page.drawText(title, { x: 40, y: 736, size: 18, font });

  let y = 708;
  for (const line of lines) {
    page.drawText(line, { x: 40, y, size: 11, font });
    y -= 18;
  }

  page.drawText("Terms: Payment due as agreed. Thank you for your business.", { x: 40, y: 60, size: 10, font });

  return pdf.save();
}

export async function GET(_request: Request, context: { params: Promise<{ type: string; id: string }> }) {
  await requireAuth();
  const { type, id } = await context.params;

  if (isDemoMode()) {
    const bytes = await buildPdf("Demo Document", ["Connect database to generate live Estimate/Invoice/Change Order PDFs."]);
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf" } });
  }

  if (type === "estimate") {
    const estimate = await prisma.estimate.findUniqueOrThrow({ where: { id }, include: { job: true, lineItems: true } });
    const bytes = await buildPdf(`Estimate - ${estimate.job.jobName}`, [
      `Status: ${estimate.status}`,
      ...estimate.lineItems.map((item) => `${item.description} - ${toNumber(item.total).toFixed(2)}`),
      `Total: $${toNumber(estimate.total).toFixed(2)}`,
    ]);
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf" } });
  }

  if (type === "invoice") {
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id }, include: { job: true, lineItems: true } });
    const bytes = await buildPdf(`Invoice - ${invoice.job.jobName}`, [
      `Status: ${invoice.status}`,
      ...invoice.lineItems.map((item) => `${item.description} - ${toNumber(item.total).toFixed(2)}`),
      `Total: $${toNumber(invoice.total).toFixed(2)}`,
    ]);
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf" } });
  }

  if (type === "change-order") {
    const co = await prisma.changeOrder.findUniqueOrThrow({ where: { id }, include: { job: true, lineItems: true } });
    const bytes = await buildPdf(`Change Order - ${co.job.jobName}`, [
      `Status: ${co.status}`,
      ...co.lineItems.map((item) => `${item.description} - ${toNumber(item.total).toFixed(2)}`),
      `Total: $${toNumber(co.total).toFixed(2)}`,
    ]);
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf" } });
  }

  return NextResponse.json({ error: "Unsupported type" }, { status: 400 });
}
