import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

async function resolvePublicJobAccess(request: Request) {
  const url = new URL(request.url);
  const portalToken = url.searchParams.get("portalToken")?.trim();
  if (portalToken) {
    const portal = await prisma.portalLink.findUnique({
      where: { token: portalToken },
      select: { jobId: true, expiresAt: true },
    });
    if (portal && (!portal.expiresAt || portal.expiresAt > new Date())) {
      return portal.jobId;
    }
  }

  const shareToken = url.searchParams.get("shareToken")?.trim();
  if (shareToken) {
    const share = await prisma.shareLink.findUnique({
      where: { token: shareToken },
      select: { jobId: true, expiresAt: true },
    });
    if (share && (!share.expiresAt || share.expiresAt > new Date())) {
      return share.jobId;
    }
  }

  return null;
}

export async function GET(request: Request, context: { params: Promise<{ type: string; id: string }> }) {
  const publicJobId = await resolvePublicJobAccess(request);
  if (!publicJobId) {
    await requireAuth();
  }
  const { type, id } = await context.params;

  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: "Invalid document id." }, { status: 400 });
  }

  if (isDemoMode()) {
    const bytes = await buildPdf("Demo Document", [
      "Connect database to generate live Estimate/Invoice/Change Order PDFs.",
    ]);
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf" } });
  }

  if (type === "estimate") {
    const estimate = await prisma.estimate.findUnique({ where: { id }, include: { job: true, lineItems: true } });
    if (!estimate) return NextResponse.json({ error: "Estimate not found." }, { status: 404 });
    if (publicJobId && estimate.jobId !== publicJobId) {
      return NextResponse.json({ error: "Estimate not found." }, { status: 404 });
    }

    const bytes = await buildPdf(`Estimate - ${estimate.job.jobName}`, [
      `Status: ${estimate.status}`,
      ...estimate.lineItems.map((item) => `${item.description} - ${toNumber(item.total).toFixed(2)}`),
      `Total: $${toNumber(estimate.total).toFixed(2)}`,
    ]);
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf" } });
  }

  if (type === "invoice") {
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { job: true, lineItems: true } });
    if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    if (publicJobId && invoice.jobId !== publicJobId) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    const bytes = await buildPdf(`Invoice - ${invoice.job.jobName}`, [
      `Status: ${invoice.status}`,
      ...invoice.lineItems.map((item) => `${item.description} - ${toNumber(item.total).toFixed(2)}`),
      `Total: $${toNumber(invoice.total).toFixed(2)}`,
    ]);
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf" } });
  }

  if (type === "change-order") {
    const changeOrder = await prisma.changeOrder.findUnique({
      where: { id },
      include: { job: true, lineItems: true },
    });
    if (!changeOrder) return NextResponse.json({ error: "Change order not found." }, { status: 404 });
    if (publicJobId && changeOrder.jobId !== publicJobId) {
      return NextResponse.json({ error: "Change order not found." }, { status: 404 });
    }

    const bytes = await buildPdf(`Change Order - ${changeOrder.job.jobName}`, [
      `Status: ${changeOrder.status}`,
      ...changeOrder.lineItems.map((item) => `${item.description} - ${toNumber(item.total).toFixed(2)}`),
      `Total: $${toNumber(changeOrder.total).toFixed(2)}`,
    ]);
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf" } });
  }

  return NextResponse.json({ error: "Unsupported type" }, { status: 400 });
}
