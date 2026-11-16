"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadTemplates, templateTriggers } from "@/components/trigger-editor";
import { Button, Callout, Card, CardHead, ErrorBox, LinkButton, PageHead, Table, Td, Th } from "@/components/ui";
import { useAction } from "@/hooks/use-load";
import { api } from "@/lib/api";
import { parseCSV } from "@/lib/csv";
import { download, money, num } from "@/lib/format";
import type { TriggerSpec } from "@/lib/types";

const REQUIRED = ["policy_ref", "insured_ref", "lat", "lon", "sum_insured", "template", "season_year"];
const BULK_LIMIT = 5000;

type Row = Record<string, string>;
type RowError = { row: number; error: string };
type BulkError = { row: number; error: string | { loc?: (string | number)[]; msg: string }[] };

function sampleCSV(year: number) {
  return `policy_ref,insured_ref,lat,lon,sum_insured,template,season_year,crop
POL-0001,BORROWER-0001,12.00,8.52,200000,maize_drought_north,${year},maize
POL-0002,BORROWER-0002,11.95,8.48,150000,maize_drought_north,${year},maize
POL-0003,BORROWER-0003,12.45,4.20,300000,rice_flood,${year},rice
`;
}

export default function UploadPage() {
  const { busy, run } = useAction();
  const [templates, setTemplates] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; errors: RowError[] } | null>(null);

  useEffect(() => {
    loadTemplates().then((t) => setTemplates(Object.keys(t))).catch(() => {});
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setResult(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const parsed = parseCSV(await file.text());
    const missing = parsed.length ? REQUIRED.filter((c) => !(c in parsed[0])) : [];
    if (!parsed.length) setFileError("The file has no data rows.");
    else if (missing.length) setFileError(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
    else setFileError(null);
    setRows(!parsed.length || missing.length ? [] : parsed);
  }

  function upload() {
    run(async () => {
      // Expand each row's template into trigger terms (one API call per template + year).
      const cache = new Map<string, TriggerSpec[] | null>();
      const errors: RowError[] = [];
      const ready: { row: number; body: object }[] = [];
      for (const [i, r] of rows.entries()) {
        const key = `${r.template}|${r.season_year}`;
        if (!cache.has(key)) cache.set(key, await templateTriggers(r.template, r.season_year).catch(() => null));
        const triggers = cache.get(key);
        if (!triggers) {
          errors.push({ row: i, error: `Unknown template "${r.template}" or bad season year "${r.season_year}"` });
          continue;
        }
        ready.push({
          row: i,
          body: {
            policy_ref: r.policy_ref,
            insured_ref: r.insured_ref,
            lat: Number(r.lat),
            lon: Number(r.lon),
            sum_insured: Number(r.sum_insured),
            ...(r.crop ? { crop: r.crop } : {}),
            triggers,
          },
        });
      }

      let created = 0;
      for (let s = 0; s < ready.length; s += BULK_LIMIT) {
        const chunk = ready.slice(s, s + BULK_LIMIT);
        const res = await api<{ created: number; errors: BulkError[] }>("/v1/contracts/bulk", { method: "POST", body: chunk.map((c) => c.body) });
        created += res.created;
        for (const er of res.errors) {
          const msg = typeof er.error === "string" ? er.error : er.error.map((x) => `${(x.loc ?? []).join(".")}: ${x.msg}`).join("; ");
          errors.push({ row: chunk[er.row].row, error: msg });
        }
      }
      setResult({ created, errors: errors.sort((a, b) => a.row - b.row) });
    });
  }

  const total = rows.reduce((a, r) => a + Number(r.sum_insured || 0), 0);

  return (
    <>
      <PageHead
        crumb={<><Link className="text-accent" href="/policies">Policies</Link> › Upload</>}
        title="Upload policies"
        sub="Register a whole loan book in one go from a spreadsheet saved as CSV."
      />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHead
            title="1. Prepare your file"
            sub={<>One row per farmer. Columns: <code>{REQUIRED.join(", ")}</code> and optional <code>crop</code>.</>}
            actions={
              <Button variant="ghost" size="sm" onClick={() => download("climasure-policies-sample.csv", sampleCSV(new Date().getFullYear()), "text/csv")}>
                Download sample CSV
              </Button>
            }
          />
          <Callout>
            Use a code for <code>insured_ref</code>, never the farmer&apos;s name, phone number or BVN. Templates:{" "}
            {templates.length ? templates.map((t, i) => <span key={t}>{i ? ", " : ""}<code>{t}</code></span>) : "loading…"}
          </Callout>
        </Card>

        <Card>
          <CardHead title="2. Choose the file" />
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:font-medium file:text-ink" />
          {fileError && <div className="mt-3.5"><ErrorBox>{fileError}</ErrorBox></div>}
          {rows.length > 0 && (
            <div className="mt-3.5">
              <p className="mb-2"><strong>{num(rows.length)} rows</strong> found, total cover {money(total)}. First rows:</p>
              <Table>
                <thead><tr><Th>Policy</Th><Th>Farmer</Th><Th>Location</Th><Th>Template</Th><Th num>Sum insured</Th></tr></thead>
                <tbody>
                  {rows.slice(0, 5).map((r, i) => (
                    <tr key={i}>
                      <Td>{r.policy_ref}</Td><Td>{r.insured_ref}</Td><Td>{r.lat}, {r.lon}</Td><Td>{r.template} {r.season_year}</Td><Td num>{money(Number(r.sum_insured))}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="mt-4 flex justify-end">
                <Button variant="primary" busy={busy} onClick={upload}>Upload {num(rows.length)} policies</Button>
              </div>
            </div>
          )}
        </Card>

        {result && (
          <Card>
            <CardHead title="Upload result" actions={<LinkButton href="/policies" variant="ghost" size="sm">View policies</LinkButton>} />
            <Callout>
              {num(result.created)} {result.created === 1 ? "policy" : "policies"} created.{" "}
              {result.errors.length ? `${num(result.errors.length)} row${result.errors.length === 1 ? "" : "s"} need fixing.` : "No errors."}
            </Callout>
            {result.errors.length > 0 && (
              <>
                <div className="mt-3">
                  <Table>
                    <thead><tr><Th>Row</Th><Th>Policy</Th><Th>Problem</Th></tr></thead>
                    <tbody>
                      {result.errors.map((er) => (
                        <tr key={er.row}><Td>{er.row + 2}</Td><Td>{rows[er.row]?.policy_ref}</Td><Td>{er.error}</Td></tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
                <p className="mt-2 text-[13px] text-ink-3">Row numbers match your spreadsheet (row 1 is the header). Fix those rows and upload just them again.</p>
              </>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
