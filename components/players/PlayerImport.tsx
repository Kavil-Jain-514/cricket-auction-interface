// components/players/PlayerImport.tsx
"use client";

import { useState, useCallback } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Upload, FileSpreadsheet, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { PLAYER_ROLES } from '@/lib/utils';

interface PlayerImportProps {
  tournamentId: Id<"tournaments">;
  onComplete: () => void;
}

interface ParsedPlayer {
  name: string;
  phoneNumber?: string;
  age: number;
  role: string[];
  battingBowlingHand: "Right-handed" | "Left-handed";
  tshirtSize?: "XS" | "S" | "M" | "L" | "XL" | "XXL" | "3XL" | "4XL";
  jerseyNumber?: number;
  jerseyName?: string;
  basePrice?: number;
  photoUrl?: string;
}

// Convert Google Drive sharing link to direct image URL
function parseGoogleDriveUrl(url: string | undefined): string | undefined {
  if (!url || typeof url !== 'string') return undefined;

  const trimmedUrl = url.trim();
  if (!trimmedUrl) return undefined;

  // Pattern 1: https://drive.google.com/file/d/FILE_ID/view?usp=sharing
  // Pattern 2: https://drive.google.com/open?id=FILE_ID
  // Pattern 3: https://drive.google.com/uc?id=FILE_ID

  let fileId: string | null = null;

  // Extract file ID from various Google Drive URL formats
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,  // /file/d/FILE_ID/
    /[?&]id=([a-zA-Z0-9_-]+)/,      // ?id=FILE_ID or &id=FILE_ID
    /\/d\/([a-zA-Z0-9_-]+)/,        // /d/FILE_ID/
  ];

  for (const pattern of patterns) {
    const match = trimmedUrl.match(pattern);
    if (match) {
      fileId = match[1];
      break;
    }
  }

  if (fileId) {
    // Use the direct export URL - works for publicly shared files
    // This format bypasses CORS issues better than thumbnail URL
    return `https://lh3.googleusercontent.com/d/${fileId}=w400`;
  }

  // If it's already a direct image URL, return as-is
  if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
    return trimmedUrl;
  }

  return undefined;
}

// Parse T-Shirt size from various formats
function parseTshirtSize(size: string): 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | '3XL' | '4XL' | undefined {
  const normalized = size.toUpperCase().trim();
  const validSizes: ('XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | '3XL' | '4XL')[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];

  if (validSizes.includes(normalized as typeof validSizes[number])) {
    return normalized as typeof validSizes[number];
  }

  // Handle variations like "2XL" -> "XXL", "XXXL" -> "3XL"
  if (normalized === '2XL') return 'XXL';
  if (normalized === 'XXXL') return '3XL';
  if (normalized === 'XXXXL') return '4XL';

  return undefined;
}

// Normalize a single role token to a valid PLAYER_ROLES value
function normalizeRole(r: string): string {
  const s = r.trim().toLowerCase();
  if (s === 'batter' || s === 'batsman' || s === 'bat') return 'Batter';
  if (s === 'bowler' || s === 'bowl') return 'Bowler';
  if (s === 'all-rounder' || s === 'all rounder' || s === 'allrounder' || s === 'ar') return 'All-Rounder';
  if (s === 'wicket keeper' || s === 'wicket-keeper' || s === 'wicketkeeper' || s === 'wk' || s === 'keeper' || s === 'wicket') return 'Wicket Keeper';
  return (PLAYER_ROLES as readonly string[]).find(role => role.toLowerCase() === s) || r.trim();
}

// Helper to get column value with flexible matching (case-insensitive and partial match)
function getColumnValue(row: Record<string, unknown>, ...possibleNames: string[]): unknown {
  const keys = Object.keys(row);

  for (const name of possibleNames) {
    // Try exact match first
    if (row[name] !== undefined) return row[name];

    // Try case-insensitive exact match
    const lowerName = name.toLowerCase();
    for (const key of keys) {
      if (key.toLowerCase() === lowerName) return row[key];
    }

    // Try partial match (column contains the search term)
    for (const key of keys) {
      if (key.toLowerCase().includes(lowerName) || lowerName.includes(key.toLowerCase())) {
        return row[key];
      }
    }
  }
  return undefined;
}

export function PlayerImport({ tournamentId, onComplete }: PlayerImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedPlayer[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const importPlayers = useMutation(api.players.bulkImport);
  const existingPlayers = useQuery(api.players.listByTournament, { tournamentId });

  // Get the starting player number for new imports
  const startingPlayerNumber = (existingPlayers?.reduce((max, p) =>
    Math.max(max, p.playerNumber || 0), 0) || 0) + 1;

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      parseExcel(selectedFile);
    }
  }, []);

  const parseExcel = async (file: File) => {
    setParsing(true);
    setErrors([]);
    setParsed([]);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];

      // --- Hyperlink extraction ---
      // sheet_to_json only returns cell values, not hyperlink targets.
      // Photos are often stored as hyperlinks (display text ≠ URL).
      // We scan every cell for a hyperlink and store it by address.
      const hyperlinksByAddress: Record<string, string> = {};
      for (const addr of Object.keys(worksheet)) {
        if (addr.startsWith('!')) continue;
        const cell = worksheet[addr] as { l?: { Target?: string } };
        if (cell?.l?.Target) {
          hyperlinksByAddress[addr] = cell.l.Target;
        }
      }

      // Find the photo column index from the header row so we can look up hyperlinks per data row
      const headerRowRaw = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 })[0] ?? [];
      const photoColIdx = (headerRowRaw as unknown[]).findIndex((h) => {
        if (typeof h !== 'string') return false;
        const l = h.toLowerCase();
        return l.includes('photo') || l.includes('image') || l === 'pic' || l === 'picture' || l.includes('drive');
      });

      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

      const players: ParsedPlayer[] = [];
      const validationErrors: string[] = [];

      jsonData.forEach((row, idx) => {
        try {
          // Parse role — support "Batter, Bowler" or "Batter / Wicket Keeper" or "Batter & Bowler"
          const rawRole = String(getColumnValue(row, 'Player Role', 'Role', 'player role', 'Roles', 'Position', 'Player Type') || '').trim();

          const parsedRoles = rawRole.length > 0
            ? rawRole
                .split(/[/,&,]+/)
                .map(r => normalizeRole(r))
                .filter(r => (PLAYER_ROLES as readonly string[]).includes(r))
            : [];

          // Resolve photo URL: prefer hyperlink target (row idx+1 because row 0 is the header)
          let resolvedPhotoUrl: string | undefined;
          if (photoColIdx >= 0) {
            const cellAddr = XLSX.utils.encode_cell({ r: idx + 1, c: photoColIdx });
            const hyperlinkTarget = hyperlinksByAddress[cellAddr];
            if (hyperlinkTarget) {
              resolvedPhotoUrl = parseGoogleDriveUrl(hyperlinkTarget) ?? undefined;
            }
          }
          // Fall back to plain cell value if no hyperlink was found
          if (!resolvedPhotoUrl) {
            resolvedPhotoUrl = parseGoogleDriveUrl(
              getColumnValue(row, 'Profile Photo', 'Photo', 'profile photo', 'Image', 'Picture', 'Pic', 'Player Photo') as string | undefined
            ) ?? undefined;
          }

          // Resolve each column value once to avoid double iteration
          const rawPhone = getColumnValue(row, 'Phone Number', 'Phone', 'phone number', 'Mobile');
          const rawJerseyNumber = getColumnValue(row, 'Jersey Number', 'Jersey No', 'jersey number');
          const rawJerseyName = getColumnValue(row, 'Jersey Name', 'jersey name', 'Jersey Name On Back', 'Name On Jersey');
          const rawBasePrice = getColumnValue(row, 'Base Price', 'base price', 'Price');

          const player: ParsedPlayer = {
            name: String(getColumnValue(row, 'Player Name', 'Name', 'player name') || '').trim(),
            phoneNumber: rawPhone ? String(rawPhone) : undefined,
            age: parseInt(String(getColumnValue(row, 'Age', 'age'))) || 0,
            role: parsedRoles,
            battingBowlingHand: String(getColumnValue(row, 'Batting/Bowling Hand', 'Hand', 'Batting Hand', 'batting/bowling hand') || '').includes('Left') ? 'Left-handed' : 'Right-handed',
            tshirtSize: parseTshirtSize(String(getColumnValue(row, 'T-Shirt Size', 'T Shirt Size', 'TShirt Size', 'Tshirt', 'T-Shirt', 'T shirt', 'tshirt size', 'Shirt Size', 'shirt', 'Jersey Size') || '')),
            jerseyNumber: rawJerseyNumber ? parseInt(String(rawJerseyNumber)) : undefined,
            jerseyName: rawJerseyName ? String(rawJerseyName).trim() : undefined,
            basePrice: rawBasePrice ? (parseInt(String(rawBasePrice)) || undefined) : undefined,
            photoUrl: resolvedPhotoUrl,
          };


          // Validation
          if (!player.name) {
            validationErrors.push(`Row ${idx + 2}: Missing player name`);
            return;
          }
          if (player.name.length < 2) {
            validationErrors.push(`Row ${idx + 2}: Player name must be at least 2 characters`);
            return;
          }
          if (player.jerseyNumber !== undefined && (player.jerseyNumber < 1)) {
            validationErrors.push(`Row ${idx + 2}: Jersey number must be 1-99 for "${player.name}"`);
            return;
          }

          players.push(player);
        } catch (error) {
          validationErrors.push(`Row ${idx + 2}: ${(error as Error).message}`);
        }
      });

      if (validationErrors.length > 0) {
        setErrors(validationErrors);
      }

      setParsed(players);

      if (players.length > 0 && validationErrors.length === 0) {
        toast.success(`Successfully parsed ${players.length} players`);
      } else if (validationErrors.length > 0) {
        toast.warning(`Parsed ${players.length} players with ${validationErrors.length} errors`);
      }

    } catch (error) {
      toast.error('Failed to parse Excel file');
      setErrors([(error as Error).message]);
    } finally {
      setParsing(false);
    }
  };

  const handleDownloadTemplate = useCallback(() => {
    try {
      const templateRows = [
        {
          'Player Name': 'John Doe',
          'Phone Number': '9876543210',
          'Age': 25,
          'Player Role': 'Batter',
          'Batting/Bowling Hand': 'Right-handed',
          'T-Shirt Size': 'L',
          'Jersey Number': 7,
          'Jersey Name': 'JOHN',
          'Base Price': 100000,
          'Profile Photo': 'https://drive.google.com/file/d/FILE_ID/view?usp=sharing',
        },
        {
          'Player Name': 'Jane Smith',
          'Phone Number': '9123456780',
          'Age': 28,
          'Player Role': 'All-Rounder',
          'Batting/Bowling Hand': 'Left-handed',
          'T-Shirt Size': 'M',
          'Jersey Number': 11,
          'Jersey Name': 'JANE',
          'Base Price': 200000,
          'Profile Photo': '',
        },
      ];

      const worksheet = XLSX.utils.json_to_sheet(templateRows);
      worksheet['!cols'] = [
        { wch: 20 }, // Player Name
        { wch: 15 }, // Phone Number
        { wch: 6 },  // Age
        { wch: 18 }, // Player Role
        { wch: 20 }, // Batting/Bowling Hand
        { wch: 12 }, // T-Shirt Size
        { wch: 14 }, // Jersey Number
        { wch: 14 }, // Jersey Name
        { wch: 12 }, // Base Price
        { wch: 45 }, // Profile Photo
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Players');
      XLSX.writeFile(workbook, 'player_import_template.xlsx');
      toast.success('Template downloaded');
    } catch {
      toast.error('Failed to download template');
    }
  }, []);

  const handleImport = async () => {
    if (parsed.length === 0) {
      toast.error('No valid players to import');
      return;
    }

    try {
      await importPlayers({
        tournamentId,
        players: parsed,
      });

      toast.success(`Imported ${parsed.length} players successfully!`);
      onComplete();
    } catch (error) {
      toast.error('Failed to import players', { description: (error as Error).message });
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* File Upload */}
      <div className="border-2 border-dashed border-slate-700 rounded-xl p-6 sm:p-8 text-center hover:border-blue-500 transition">
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileSelect}
          className="hidden"
          id="excel-upload"
        />
        <label htmlFor="excel-upload" className="cursor-pointer min-h-24 sm:min-h-32 flex flex-col items-center justify-center">
          <Upload className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 sm:mb-4 text-slate-400" />
          <div className="text-base sm:text-lg font-semibold mb-2">
            {file ? file.name : 'Upload Excel File'}
          </div>
          <div className="text-xs sm:text-sm text-slate-400">
            Click to browse or drag and drop
          </div>
        </label>
      </div>

      {/* Parsing Status */}
      {parsing && (
        <div className="flex items-center justify-center gap-3 py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          <span className="text-slate-400">Parsing Excel file...</span>
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-red-500/10 border border-red-500 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <XCircle className="w-5 h-5 text-red-500" />
            <span className="font-semibold text-red-500">
              {errors.length} Validation Error{errors.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {errors.map((error, idx) => (
              <div key={idx} className="text-sm text-red-400">
                {error}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preview */}
      {parsed.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="font-semibold text-sm sm:text-base">
                {parsed.length} Players Ready to Import
              </span>
            </div>
            <Button onClick={handleImport} size="lg" className="w-full sm:w-auto min-h-11 touch-target">
              <FileSpreadsheet className="w-5 h-5 mr-2" />
              Import All Players
            </Button>
          </div>

          <div className="bg-slate-800 rounded-lg overflow-hidden">
            <div className="overflow-auto max-h-[45vh] ipad-scroll">
              <table className="w-full min-w-160">
                <thead className="bg-slate-900 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold bg-slate-900">#</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold bg-slate-900">Photo</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold bg-slate-900">Name</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold bg-slate-900">Role</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold bg-slate-900">Age</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold bg-slate-900">Hand</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold bg-slate-900">Jersey #</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold bg-slate-900">Jersey Name</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold bg-slate-900">T-Shirt</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold bg-slate-900">Base Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {parsed.map((player, idx) => (
                    <tr key={idx} className="hover:bg-slate-700/50">
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold">
                          {startingPlayerNumber + idx}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {player.photoUrl ? (
                          <div className="relative w-10 h-10">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={player.photoUrl}
                              alt={player.name}
                              className="w-10 h-10 rounded-full object-cover border border-slate-600"
                              referrerPolicy="no-referrer"
                              crossOrigin="anonymous"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.onerror = null;
                                // Show initials as fallback
                                target.style.display = 'none';
                                const fallback = target.nextElementSibling as HTMLElement;
                                if (fallback) fallback.style.display = 'flex';
                              }}
                            />
                            <div
                              className="w-10 h-10 rounded-full bg-linear-to-br from-blue-500 to-purple-600 items-center justify-center text-white text-xs font-bold absolute inset-0"
                              style={{ display: 'none' }}
                            >
                              {player.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                          </div>
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-linear-to-br from-slate-600 to-slate-700 flex items-center justify-center text-white text-xs font-bold">
                            {player.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">{player.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {player.role.map((r) => (
                            <span key={r} className="px-2 py-1 bg-purple-600 rounded text-xs">
                              {r}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">{player.age}</td>
                      <td className="px-4 py-3 text-sm">{player.battingBowlingHand}</td>
                      <td className="px-4 py-3 text-sm">{player.jerseyNumber || '-'}</td>
                      <td className="px-4 py-3 text-sm">{player.jerseyName || '-'}</td>
                      <td className="px-4 py-3 text-sm">{player.tshirtSize || '-'}</td>
                      <td className="px-4 py-3 text-sm font-semibold">
                        {player.basePrice ? `₹${(player.basePrice / 100000).toFixed(1)}L` : 'Default'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.length > 8 && (
              <div className="px-4 py-2.5 bg-slate-900 text-center text-xs text-slate-400 border-t border-slate-700">
                Scroll to view all {parsed.length} players
              </div>
            )}
          </div>
        </div>
      )}

      {/* Template Download */}
      <div className="bg-blue-500/10 border border-blue-500 rounded-lg p-4">
        <div className="flex flex-col sm:flex-row items-start gap-3">
          <FileSpreadsheet className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold mb-1 text-sm sm:text-base">Need a template?</div>
            <div className="text-xs sm:text-sm text-slate-400 mb-3">
              Download our Excel template with all required columns and sample data.
            </div>
            <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="min-h-10 touch-target w-full sm:w-auto">
              Download Template
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}