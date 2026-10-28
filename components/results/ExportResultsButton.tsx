"use client";

import { useState } from 'react';
import { useConvex } from 'convex/react';
import { FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/utils';
import { buildResultsSheets } from '@/lib/resultsWorkbook';

interface ExportResultsButtonProps {
  tournamentId: Id<"tournaments">;
  className?: string;
}

/**
 * Admin-only "Export results (.xlsx)". Fetches once on click (no live
 * subscription), so phone numbers are only requested when the box is ticked.
 */
export function ExportResultsButton({ tournamentId, className }: ExportResultsButtonProps) {
  const convex = useConvex();
  const [includeContacts, setIncludeContacts] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const [data, XLSX] = await Promise.all([
        convex.query(api.results.getResultsExport, { tournamentId, includeContacts }),
        import('xlsx'),
      ]);
      const workbook = XLSX.utils.book_new();
      for (const [name, rows] of Object.entries(buildResultsSheets(data))) {
        const sheet = XLSX.utils.aoa_to_sheet(rows);
        sheet['!cols'] = rows[0].map((_, col) => ({
          wch: Math.min(40, Math.max(...rows.map((r) => String(r[col] ?? '').length), 8) + 2),
        }));
        XLSX.utils.book_append_sheet(workbook, sheet, name);
      }
      const safeName = data.tournament.name.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'tournament';
      XLSX.writeFile(workbook, `${safeName}_results.xlsx`);
      toast.success('Results exported');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to export results'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={`inline-flex items-center gap-3 ${className ?? ''}`}>
      <Button
        onClick={handleExport}
        disabled={exporting}
        variant="outline"
        className="border-green-600 text-green-400 hover:bg-green-600 hover:text-white h-11 px-4 sm:px-5 text-sm"
      >
        <FileSpreadsheet className="w-4 h-4 mr-2" />
        {exporting ? 'Exporting…' : 'Export results (.xlsx)'}
      </Button>
      <label className="flex items-center gap-1.5 text-xs text-slate-400" title="Adds a Contacts sheet with phone numbers. Keep it private.">
        <input type="checkbox" checked={includeContacts} onChange={(e) => setIncludeContacts(e.target.checked)} />
        Include phone numbers
      </label>
    </div>
  );
}
