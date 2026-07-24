import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseFinancialWorkbook } from "@/lib/excel-import";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".xlsx", ".xls"];

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Pilih file Excel terlebih dahulu." }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "File terlalu besar. Maksimum 8 MB untuk MVP 1.2C." }, { status: 400 });
    const lowerName = file.name.toLowerCase();
    if (!ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) return NextResponse.json({ error: "Format harus .xlsx atau .xls." }, { status: 400 });

    const rows = parseFinancialWorkbook(await file.arrayBuffer());
    const mappings = await prisma.accountMapping.findMany({ where: { isActive: true } });
    const canonicalAccounts = await prisma.canonicalAccount.findMany({ where: { isActive: true } });
    const canonicalById = new Map(canonicalAccounts.map((account) => [account.id, account]));
    const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
    const mappingByName = new Map(mappings.map((mapping) => [normalize(mapping.reportedAccount), mapping]));

    const preview = rows.map((row) => {
      const mapping = mappingByName.get(normalize(row.reportedAccount));
      const canonical = mapping ? canonicalById.get(mapping.canonicalAccountId) : undefined;
      return {
        ...row,
        mapped: Boolean(canonical),
        canonicalCode: canonical?.code ?? null,
        canonicalName: canonical?.name ?? null,
      };
    });

    return NextResponse.json({
      fileName: file.name,
      rows: preview,
      summary: {
        extracted: preview.length,
        mapped: preview.filter((row) => row.mapped).length,
        unmapped: preview.filter((row) => !row.mapped).length,
      },
      mode: "PREVIEW_ONLY",
      message: "Preview berhasil. Belum ada angka yang disimpan ke PostgreSQL sampai user melakukan review dan konfirmasi.",
    });
  } catch (error) {
    console.error("Excel import preview failed", error);
    return NextResponse.json({ error: "Excel tidak dapat dibaca. Periksa format file dan header kolom." }, { status: 400 });
  }
}
