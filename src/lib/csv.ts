import { NextResponse } from "next/server";

export function csvResponse(name: string, header: string[], rows: Array<Array<string | number>>) {
  const lines = [header.join(","), ...rows.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","))];
  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=${name}`,
    },
  });
}
