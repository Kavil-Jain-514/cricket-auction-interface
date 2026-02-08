// components/players/PlayerImport.tsx
"use client";

import { useState, useCallback } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Upload, FileSpreadsheet, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

interface PlayerImportProps {
  tournamentId: string;
  onComplete: () => void;
}

interface ParsedPlayer {
  name: string;
  phoneNumber?: string;
  age: number;
  role: string;
  battingBowlingHand: string;
  jerseyNumber?: number;
  availability: {
    type: 'available' | 'unavailable';
    dates?: string[];
  };
  basePrice: number;
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

export function PlayerImport({ tournamentId, onComplete }: PlayerImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedPlayer[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  
  const importPlayers = useMutation(api.players.bulkImport);

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
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

      const players: ParsedPlayer[] = [];
      const validationErrors: string[] = [];

      jsonData.forEach((row, idx) => {
        try {
          // Parse availability
          const availabilityText = row['Availability'] || 'available';
          let availability: ParsedPlayer['availability'];
          
          if (availabilityText.toLowerCase().includes('unavailable')) {
            // Extract dates from text like "Unavailable on 5th, 6th, 7th March"
            const dates = availabilityText.match(/\d+/g)?.map((day: string) => 
              `2025-03-${day.padStart(2, '0')}`
            ) || [];
            availability = { type: 'unavailable', dates };
          } else {
            availability = { type: 'available' };
          }

          const player: ParsedPlayer = {
            name: row['Player Name']?.trim(),
            phoneNumber: row['Phone Number']?.toString(),
            age: parseInt(row['Age']) || 0,
            role: row['Player Role']?.trim() || 'All- Rounder',
            battingBowlingHand: row['Batting/Bowling Hand']?.includes('Left-handed') ? 'Left-handed' : 'Right-handed',
            jerseyNumber: row['Jersey Number'] ? parseInt(row['Jersey Number']) : undefined,
            availability,
            basePrice: parseInt(row['Base Price']) || 100000,
            photoUrl: parseGoogleDriveUrl(row['Profile Photo'] as string | undefined),
          };

          // Debug: Log photo URL parsing
          console.log(`Player ${player.name}: Raw URL = "${row['Profile Photo']}" -> Parsed = "${player.photoUrl}"`);

          // Validation
          if (!player.name) {
            validationErrors.push(`Row ${idx + 2}: Missing player name`);
            return;
          }
          if (player.age < 15 || player.age > 65) {
            validationErrors.push(`Row ${idx + 2}: Invalid age for ${player.name}`);
            return;
          }
          if (!['Batter', 'Bowler', 'All-Rounder'].includes(player.role)) {
            validationErrors.push(`Row ${idx + 2}: Invalid role for ${player.name}`);
            return;
          }

          players.push(player);
        } catch (error) {
          validationErrors.push(`Row ${idx + 2}: ${error.message}`);
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
      setErrors([error.message]);
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (parsed.length === 0) return;

    try {
      await importPlayers({
        tournamentId,
        players: parsed.map(p => ({
          ...p,
          tournamentId,
          auctionStatus: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })),
      });

      toast.success(`Imported ${parsed.length} players successfully!`);
      onComplete();
    } catch (error) {
      toast.error('Failed to import players', { description: error.message });
    }
  };

  return (
    <div className="space-y-6">
      {/* File Upload */}
      <div className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center hover:border-blue-500 transition">
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileSelect}
          className="hidden"
          id="excel-upload"
        />
        <label htmlFor="excel-upload" className="cursor-pointer">
          <Upload className="w-12 h-12 mx-auto mb-4 text-slate-400" />
          <div className="text-lg font-semibold mb-2">
            {file ? file.name : 'Upload Excel File'}
          </div>
          <div className="text-sm text-slate-400">
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="font-semibold">
                {parsed.length} Players Ready to Import
              </span>
            </div>
            <Button onClick={handleImport} size="lg">
              <FileSpreadsheet className="w-5 h-5 mr-2" />
              Import All Players
            </Button>
          </div>

          <div className="bg-slate-800 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Photo</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Name</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Role</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Age</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Hand</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Base Price</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Availability</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {parsed.slice(0, 10).map((player, idx) => (
                    <tr key={idx} className="hover:bg-slate-700/50">
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
                        <span className="px-2 py-1 bg-purple-600 rounded text-xs">
                          {player.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">{player.age}</td>
                      <td className="px-4 py-3 text-sm">{player.battingBowlingHand}</td>
                      <td className="px-4 py-3 text-sm font-semibold">
                        ₹{(player.basePrice / 100000).toFixed(1)}L
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs ${
                          player.availability.type === 'available'
                            ? 'bg-green-600'
                            : 'bg-orange-600'
                        }`}>
                          {player.availability.type === 'available' 
                            ? 'Available' 
                            : `Unavailable (${player.availability.dates?.length} days)`
                          }
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.length > 10 && (
              <div className="px-4 py-3 bg-slate-900 text-center text-sm text-slate-400">
                Showing 10 of {parsed.length} players
              </div>
            )}
          </div>
        </div>
      )}

      {/* Template Download */}
      <div className="bg-blue-500/10 border border-blue-500 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="w-5 h-5 text-blue-500 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold mb-1">Need a template?</div>
            <div className="text-sm text-slate-400 mb-3">
              Download our Excel template with all required columns and sample data.
            </div>
            <Button variant="outline" size="sm">
              Download Template
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}