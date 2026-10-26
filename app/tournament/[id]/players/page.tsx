
"use client";

import { use, useCallback, useMemo, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Doc, Id } from '@/convex/_generated/dataModel';
import Link from 'next/link';
import { ArrowLeft, Plus, Upload, Users, Trash2, AlertTriangle, Download, Eye, X, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Navbar } from '@/components/layout/Navbar';
import { PlayerCard } from '@/components/players/PlayerCard';
import { PlayerImport } from '@/components/players/PlayerImport';
import { PlayerForm } from '@/components/players/PlayerForm';
import { PlayerDetailsModal } from '@/components/players/PlayerDetailsModal';
import { toast } from 'sonner';
import { getRoles, getRoleDisplay } from '@/lib/utils';
import jsPDF from 'jspdf';

import { useTournamentRole } from '@/hooks/useTournamentRole';


export default function PlayersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tournamentId = id as Id<"tournaments">;
  const [showImport, setShowImport] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [filterRole, setFilterRole] = useState<string>('all');
  type StatusFilter = 'all' | 'pending' | 'in_auction' | 'sold' | 'unsold';
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<Doc<"players"> | null>(null);
  const tournament = useQuery(api.tournaments.getById, { id: tournamentId });
  const allPlayers = useQuery(api.players.listByTournament, { tournamentId });
  const teams = useQuery(api.teams.listByTournament, { tournamentId });
  const deleteAllPlayers = useMutation(api.players.deleteAllByTournament);
  const { canManage } = useTournamentRole(tournamentId);

  // Get team name for a player
  const getTeamName = useCallback((teamId?: Id<"teams">) => {
    if (!teamId || !teams) return undefined;
    return teams.find(t => t._id === teamId)?.name;
  }, [teams]);

  // Players chosen as a team captain get a "C" tag
  const captainPlayerIds = useMemo(
    () => new Set((teams ?? []).flatMap(t => t.captainPlayerId ? [t.captainPlayerId] : [])),
    [teams]
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const players = allPlayers?.filter(p => {
    // Captains are pre-assigned and never auctioned. Keep them out of the
    // status-filtered views (pending/sold/…) so the list matches the status
    // counts below; they remain visible (with the "C" tag) under the "All" tab.
    const statusMatch = filterStatus === 'all'
      ? true
      : p.auctionStatus === filterStatus && !captainPlayerIds.has(p._id);
    const roleMatch = filterRole === 'all' || getRoles(p.role).includes(filterRole);
    // Search by name, player number, phone, or jersey name.
    const searchMatch = normalizedQuery === '' || [
      p.name,
      p.playerNumber != null ? `#${p.playerNumber}` : '',
      p.playerNumber != null ? String(p.playerNumber) : '',
      p.phoneNumber ?? '',
      p.jerseyName ?? '',
    ].some(field => field.toLowerCase().includes(normalizedQuery));
    return statusMatch && roleMatch && searchMatch;
  }
  );

  // Auction status counts exclude captains (they never enter the auction).
  const stats = useMemo(() => {
    const auctionable = (allPlayers ?? []).filter(p => !captainPlayerIds.has(p._id));
    return {
      total: allPlayers?.length || 0,
      pending: auctionable.filter(p => p.auctionStatus === 'pending').length,
      inAuction: auctionable.filter(p => p.auctionStatus === 'in_auction').length,
      sold: auctionable.filter(p => p.auctionStatus === 'sold').length,
      unsold: auctionable.filter(p => p.auctionStatus === 'unsold').length,
      batters: allPlayers?.filter(p => getRoles(p.role).includes('Batter')).length || 0,
      bowlers: allPlayers?.filter(p => getRoles(p.role).includes('Bowler')).length || 0,
      allRounders: allPlayers?.filter(p => getRoles(p.role).includes('All-Rounder')).length || 0,
      wicketKeepers: allPlayers?.filter(p => getRoles(p.role).includes('Wicket Keeper')).length || 0,
    };
  }, [allPlayers, captainPlayerIds]);

  // Download all players as PDF
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const hasCaptains = captainPlayerIds.size > 0;

  const handleDownloadAllPlayers = useCallback(async (includeCaptains: boolean = true) => {
    if (!allPlayers || allPlayers.length === 0) {
      toast.error('No players to download');
      return;
    }

    // Optionally exclude team captains from the exported list.
    const playersToExport = includeCaptains
      ? allPlayers
      : allPlayers.filter(p => !captainPlayerIds.has(p._id));

    if (playersToExport.length === 0) {
      toast.error('No players to download');
      return;
    }

    setIsGeneratingPDF(true);
    toast.info('Generating PDF with player photos...');

    try {
      // Pre-load all player images + tournament logo
      const imageCache: Record<string, string> = {};
      let tournamentLogoBase64: string | null = null;

      // Force Cloudinary URLs to serve JPEG (jsPDF doesn't support WebP)
      const forceJpegUrl = (url: string): string => {
        if (url.includes('res.cloudinary.com') && url.includes('/upload/')) {
          let modified = url.replace('/upload/', '/upload/f_jpg,q_80/');
          if (url.includes('/upload/f_auto')) {
            modified = url.replace('f_auto', 'f_jpg');
          }
          return modified;
        }
        return url;
      };

      const loadImage = async (url: string): Promise<string | null> => {
        try {
          const processedUrl = forceJpegUrl(url);
          // Use server-side proxy to bypass CORS (Google Drive, Cloudinary, etc.)
          const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(processedUrl)}`;
          const response = await fetch(proxyUrl);
          if (!response.ok) return null;
          const data = await response.json();
          return data.dataUrl ?? null;
        } catch {
          return null;
        }
      };

      // Load tournament logo
      if (tournament?.logoUrl) {
        tournamentLogoBase64 = await loadImage(tournament.logoUrl);
      }

      // Load all player images in parallel
      const imagePromises = playersToExport
        .filter(p => p.photoUrl)
        .map(async (p) => {
          if (p.photoUrl) {
            const dataUrl = await loadImage(p.photoUrl);
            if (dataUrl) {
              imageCache[p._id] = dataUrl;
            }
          }
        });

      await Promise.all(imagePromises);

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const contentWidth = pageWidth - 2 * margin;
      const colGap = 2;
      const rowGap = 2;

      // Card dimensions - 3 columns × 9 rows = 27 players per page
      const cols = 3;
      const rows = 9;
      const cardsPerPage = cols * rows; // 27
      const cardWidth = (contentWidth - (cols - 1) * colGap) / cols;
      const headerHeight = 32; // Space for tournament header
      const gridHeight = pageHeight - headerHeight - margin;
      const cardHeight = (gridHeight - (rows - 1) * rowGap) / rows;
      const photoWidth = 25; // Photo width in mm


      // Helper to draw tournament header
      const drawHeader = (page: number, totalPages: number) => {
        // Page background
        pdf.setFillColor(15, 23, 42); // slate-900
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');

        // Header accent bar
        pdf.setFillColor(59, 130, 246); // blue-500
        pdf.rect(0, 0, pageWidth, 3, 'F');
        // Bid11Pro Text (simulating gradient with orange to yellow)
        pdf.setFontSize(14);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(249, 115, 22); // orange-500
        pdf.text("Bid11", margin + 20, 15);
        const nextX = margin + 20 + pdf.getTextWidth("Bid11");
        pdf.setTextColor(234, 179, 8); // yellow-500
        pdf.text("Pro", nextX, 15);

        // Subtitle
        pdf.setFontSize(5);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(148, 163, 184); // slate-400
        pdf.text("Cricket Auction Platform", margin + 20, 17.5);

        // Center Tournament Logo and Name
        const logoSize = 18;
        if (tournament?.name) {
          pdf.setFontSize(20);
          pdf.setFont('helvetica', 'bold');
          const titleWidth = pdf.getTextWidth(tournament.name.toUpperCase());
          let contentWidth = titleWidth;
          if (tournamentLogoBase64) {
            contentWidth += logoSize + 4;
          }

          let startX = (pageWidth - contentWidth) / 2;

          if (tournamentLogoBase64) {
            try {
              const logoFormat = tournamentLogoBase64.includes('image/png') ? 'PNG' : 'JPEG';
              pdf.addImage(tournamentLogoBase64, logoFormat, startX, 6, logoSize, logoSize);
              startX += logoSize + 4;
            } catch {
              // Logo failed to load — continue without it
            }
          }

          pdf.setTextColor(255, 255, 255);
          pdf.text(tournament.name.toUpperCase(), startX + titleWidth / 2, 19, { align: 'center' });
        } else if (tournamentLogoBase64) {
          try {
            const logoFormat = tournamentLogoBase64.includes('image/png') ? 'PNG' : 'JPEG';
            pdf.addImage(tournamentLogoBase64, logoFormat, (pageWidth - logoSize) / 2, 6, logoSize, logoSize);
          } catch {
            // Logo failed to load — continue without it
          }
        }

        // Page number (right side of header)
        pdf.setFontSize(7);
        pdf.setTextColor(100, 116, 139);
        pdf.text(`Page ${page + 1} / ${totalPages}`, pageWidth - margin - 2, 12, { align: 'right' });
      };

      // Helper to draw a player card
      const drawPlayerCard = (player: Doc<"players">, x: number, y: number) => {
        const primaryRole = getRoles(player.role)[0];
        const hasRole = Boolean(primaryRole && primaryRole.trim());
        const roleColor = primaryRole === 'Batter' ? [59, 130, 246] : // blue
          primaryRole === 'Bowler' ? [249, 115, 22] : // orange
            primaryRole?.includes('All') ? [147, 51, 234] : // purple
              primaryRole === 'Wicket Keeper' ? [16, 185, 129] : // emerald
                [100, 116, 139]; // slate-500 (neutral) when player type is unavailable

        // Card background and border
        pdf.setDrawColor(roleColor[0], roleColor[1], roleColor[2]);
        pdf.setLineWidth(0.6);
        pdf.setFillColor(30, 41, 59); // slate-800
        pdf.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'FD');

        // Watermark (Bid11Pro)
        pdf.setTextColor(220, 38, 38, 0.08); // red-600 with lower opacity for lighter watermark
        pdf.setFontSize(14);
        pdf.setFont("helvetica", "bold");
        pdf.text("Bid11Pro", x + cardWidth / 2 + 6, y + cardHeight / 2 + 2, { align: "center", angle: 30 });
        // pdf.setFillColor(roleColor[0], roleColor[1], roleColor[2]);
        // pdf.roundedRect(x, y, 2.5, cardHeight, 2, 0, 'F');
        // pdf.rect(x + 1.5, y, 1, cardHeight, 'F');
        // Player photo - left side, takes full card height
        const photoX = x;
        const photoY = y;
        const actualPhotoWidth = photoWidth;
        const actualPhotoHeight = cardHeight;

        if (imageCache[player._id]) {
          try {
            const imgData = imageCache[player._id];
            const imgFormat = imgData.includes('image/png') ? 'PNG' : 'JPEG';
            pdf.addImage(imgData, imgFormat, photoX, photoY, actualPhotoWidth, actualPhotoHeight);

            // Add border to photo
            pdf.setDrawColor(100, 116, 139); // slate-500
            pdf.setLineWidth(0.4);
            pdf.rect(photoX, photoY, actualPhotoWidth, actualPhotoHeight, 'S');
          } catch {
            // Image render failed — card still renders without photo
          }
        }

        // Player number overlapping photo and card border (top-left badge)
        if (player.playerNumber) {
          const numberText = `${player.playerNumber}`;
          pdf.setFontSize(6.5);
          pdf.setFont('helvetica', 'bold');
          const numWidth = pdf.getTextWidth(numberText) + 3;
          const numHeight = 4.5;
          // Dark badge background
          pdf.setFillColor(15, 23, 42); // slate-900
          pdf.roundedRect(photoX, photoY, numWidth, numHeight, 1.5, 1.5, 'F');
          pdf.setTextColor(roleColor[0], roleColor[1], roleColor[2]);
          pdf.text(numberText, photoX + 1.5, photoY + 3.3);
        }

        // Captain badge - top-right of photo ("C" tag)
        if (captainPlayerIds.has(player._id)) {
          const badgeSize = 4.5;
          const badgeX = photoX + actualPhotoWidth - badgeSize;
          const badgeY = photoY;
          pdf.setFillColor(234, 179, 8); // yellow-500
          pdf.roundedRect(badgeX, badgeY, badgeSize, badgeSize, 1.5, 1.5, 'F');
          pdf.setFontSize(7);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(15, 23, 42); // slate-900
          pdf.text('C', badgeX + badgeSize / 2, badgeY + 3.3, { align: 'center' });
        }


        // Text content - right of photo
        const textX = photoX + actualPhotoWidth + 2.5;
        const textMaxWidth = cardWidth - actualPhotoWidth;
        // Player name - big bold font wrapped
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(7.5);
        pdf.setFont('helvetica', 'bold');

        const nameLines = pdf.splitTextToSize(player.name.toUpperCase(), textMaxWidth - 1);
        if (nameLines.length > 2) {
          nameLines.length = 2;
          nameLines[1] = nameLines[1].substring(0, nameLines[1].length - 2) + '..';
        }
        pdf.text(nameLines, textX, y + 6);

        const linesOffset = nameLines.length > 1 ? 3 : 0;

        // Age & Phone number side by side, below name
        pdf.setFontSize(6);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(148, 163, 184); // slate-400
        const ageText = `${player.age} yrs`;
        const phoneText = player.phoneNumber || '';
        const separator = phoneText ? '  |  ' : '';
        pdf.text(`${ageText}${separator}${phoneText}`, textX, y + 9 + linesOffset);

        // Player type - smallest font, below age (only when a role is available)
        if (hasRole) {
          pdf.setFontSize(6);
          pdf.setFillColor(roleColor[0], roleColor[1], roleColor[2]);
          const roleDisplayText = getRoleDisplay(player.role);
          const roleBadgeWidth = pdf.getTextWidth(roleDisplayText) + 4;
          const roleBadgeY = y + 11.5 + linesOffset;
          pdf.roundedRect(textX, roleBadgeY, roleBadgeWidth, 4, 0.8, 0.8, 'F');
          pdf.setTextColor(255, 255, 255);
          pdf.setFont('helvetica', 'bold');
          pdf.text(roleDisplayText, textX + 2, roleBadgeY + 3);
        }

        // Player Batting/Bowling Hand
        pdf.setFontSize(6);
        pdf.setTextColor(148, 163, 184); // slate-400
        pdf.text(`${player.battingBowlingHand}`, textX, y + 18.5 + linesOffset);

      };

      // Draw each page
      const totalPages = Math.ceil(playersToExport.length / cardsPerPage);

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) {
          pdf.addPage();
        }

        drawHeader(page, totalPages);

        // Draw player cards
        const startIdx = page * cardsPerPage;
        const endIdx = Math.min(startIdx + cardsPerPage, playersToExport.length);

        for (let i = startIdx; i < endIdx; i++) {
          const player = playersToExport[i];
          const cardIndex = i - startIdx;
          const col = cardIndex % cols;
          const row = Math.floor(cardIndex / cols);

          const x = margin + col * (cardWidth + colGap);
          const y = headerHeight + row * (cardHeight + rowGap);

          drawPlayerCard(player, x, y);
        }
      }

      // Save the PDF
      const captainSuffix = includeCaptains ? 'All_Players' : 'Players_No_Captains';
      const fileName = `${tournament?.name?.replace(/\s+/g, '_') || 'Tournament'}_${captainSuffix}.pdf`;
      pdf.save(fileName);
      toast.success(`Downloaded ${playersToExport.length} players as PDF`);
    } catch {
      toast.error('Failed to generate PDF');
    } finally {
      setIsGeneratingPDF(false);
    }
  }, [allPlayers, tournament, captainPlayerIds]);


  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 safe-bottom">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <Link href={`/tournament/${tournamentId}`} className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition mb-4 py-2 touch-target">
            <ArrowLeft className="w-5 h-5" />
            <span>Back to Tournament</span>
          </Link>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2">Player Management</h1>
              <p className="text-slate-400 text-sm sm:text-base">{tournament?.name}</p>
            </div>

            <div className="flex flex-wrap gap-2 sm:gap-3">
              {/* Viewer Mode Indicator */}
              {!canManage && (
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/60 rounded-lg border border-slate-700 h-11">
                  <Eye className="w-4 h-4 text-blue-400" />
                  <span className="text-sm text-slate-300">Viewer Mode</span>
                </div>
              )}

              {stats.total > 0 && canManage && (
                <>
                  <div className="relative">
                    <Button
                      variant="outline"
                      onClick={() => {
                        // No captains selected — nothing to choose, download directly.
                        if (!hasCaptains) {
                          handleDownloadAllPlayers(true);
                        } else {
                          setShowDownloadMenu(prev => !prev);
                        }
                      }}
                      disabled={isGeneratingPDF}
                      className="border-green-500/50 text-green-400 hover:bg-green-500/10 hover:text-green-300 h-11 px-3 sm:px-4 text-sm disabled:opacity-50"
                    >
                      {isGeneratingPDF ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-400 sm:mr-2" />
                          <span className="hidden sm:inline">Generating...</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4 sm:mr-2" />
                          <span className="hidden sm:inline">Download PDF</span>
                        </>
                      )}
                    </Button>

                    {showDownloadMenu && hasCaptains && !isGeneratingPDF && (
                      <>
                        {/* Click-away overlay */}
                        <button
                          type="button"
                          aria-label="Close download menu"
                          className="fixed inset-0 z-40 cursor-default"
                          onClick={() => setShowDownloadMenu(false)}
                        />
                        <div className="absolute right-0 mt-2 w-52 z-50 rounded-lg border border-slate-700 bg-slate-900 shadow-xl overflow-hidden">
                          <button
                            onClick={() => {
                              setShowDownloadMenu(false);
                              handleDownloadAllPlayers(true);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-3 text-sm text-slate-200 hover:bg-slate-800 transition text-left"
                          >
                            <Download className="w-4 h-4 text-green-400 shrink-0" />
                            With Captains
                          </button>
                          <div className="h-px bg-slate-700" />
                          <button
                            onClick={() => {
                              setShowDownloadMenu(false);
                              handleDownloadAllPlayers(false);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-3 text-sm text-slate-200 hover:bg-slate-800 transition text-left"
                          >
                            <Download className="w-4 h-4 text-green-400 shrink-0" />
                            Without Captains
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300 h-11 px-3 sm:px-4 text-sm"
                  >
                    <Trash2 className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">Delete All</span>
                  </Button>
                </>
              )}
              {canManage && (
                <>
                  <Button variant="outline" onClick={() => setShowImport(true)} className="h-11 px-3 sm:px-4 text-sm">
                    <Upload className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">Import Excel</span>
                  </Button>
                  <Button onClick={() => setShowAddForm(true)} className="h-11 px-4 text-sm">
                    <Plus className="w-4 h-4 mr-1 sm:mr-2" />
                    Add Player
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="mb-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search players by name, number, phone…"
              aria-label="Search players"
              className="pl-9 pr-9 h-11"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-700 transition"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Stats - Status Based */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-6 overflow-x-auto pb-2 ipad-scroll">
          {/* Status Filters */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <span className="text-xs sm:text-sm text-slate-400 mr-1">Status:</span>
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${filterStatus === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
            >
              All ({stats.total})
            </button>
            <button
              onClick={() => setFilterStatus('pending')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${filterStatus === 'pending'
                ? 'bg-slate-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
            >
              Pending ({stats.pending})
            </button>
            <button
              onClick={() => setFilterStatus('in_auction')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${filterStatus === 'in_auction'
                ? 'bg-yellow-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
            >
              In Auction ({stats.inAuction})
            </button>
            <button
              onClick={() => setFilterStatus('sold')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${filterStatus === 'sold'
                ? 'bg-green-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
            >
              Sold ({stats.sold})
            </button>
            <button
              onClick={() => setFilterStatus('unsold')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${filterStatus === 'unsold'
                ? 'bg-red-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
            >
              Unsold ({stats.unsold})
            </button>
          </div>

          <div className="h-6 w-px bg-slate-700 hidden sm:block" />

          {/* Role Filters */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <span className="text-xs sm:text-sm text-slate-400 mr-1">Role:</span>
            {filterRole !== 'all' && (
              <button
                onClick={() => setFilterRole('all')}
                className="px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target bg-slate-800 text-slate-400 hover:bg-slate-700"
              >
                All
              </button>
            )}
            <button
              onClick={() => setFilterRole(filterRole === 'Batter' ? 'all' : 'Batter')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${filterRole === 'Batter'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
            >
              Batters ({stats.batters})
            </button>
            <button
              onClick={() => setFilterRole(filterRole === 'Bowler' ? 'all' : 'Bowler')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${filterRole === 'Bowler'
                ? 'bg-red-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
            >
              Bowlers ({stats.bowlers})
            </button>
            <button
              onClick={() => setFilterRole(filterRole === 'All-Rounder' ? 'all' : 'All-Rounder')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${filterRole === 'All-Rounder'
                ? 'bg-purple-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
            >
              All-Rounders ({stats.allRounders})
            </button>
            <button
              onClick={() => setFilterRole(filterRole === 'Wicket Keeper' ? 'all' : 'Wicket Keeper')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${filterRole === 'Wicket Keeper'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
            >
              WK ({stats.wicketKeepers})
            </button>
          </div>

          {/* Clear Filters */}
          {(filterStatus !== 'all' || filterRole !== 'all') && (
            <>
              <div className="h-6 w-px bg-slate-700 hidden sm:block" />
              <button
                onClick={() => {
                  setFilterStatus('all');
                  setFilterRole('all');
                }}
                className="px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition touch-target"
              >
                Clear Filters
              </button>
            </>
          )}
        </div>

        {/* Players Grid */}
        {!players ? (
          <div className="flex items-center justify-center py-16 sm:py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
          </div>
        ) : players.length === 0 ? (
          (allPlayers?.length ?? 0) > 0 ? (
            // Players exist but none match the current search / filters.
            <div className="text-center py-12 sm:py-16 lg:py-20">
              <Search className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 text-slate-700" />
              <h3 className="text-lg sm:text-xl font-semibold mb-2">No players found</h3>
              <p className="text-slate-400 mb-6 text-sm sm:text-base px-4">
                {normalizedQuery
                  ? <>No players match &ldquo;<span className="text-slate-300">{searchQuery}</span>&rdquo;. Try a different search or clear your filters.</>
                  : 'No players match the current filters.'}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setSearchQuery('');
                  setFilterStatus('all');
                  setFilterRole('all');
                }}
                className="h-11 text-base"
              >
                Clear search & filters
              </Button>
            </div>
          ) : (
            <div className="text-center py-12 sm:py-16 lg:py-20">
              <Users className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 text-slate-700" />
              <h3 className="text-lg sm:text-xl font-semibold mb-2">No players yet</h3>
              <p className="text-slate-400 mb-6 text-sm sm:text-base px-4">
                Add players or import from Excel to get started
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center px-4">
                <Button onClick={() => setShowImport(true)} variant="outline" className="h-11 sm:h-12 text-base">
                  <Upload className="w-5 h-5 mr-2" />
                  Import from Excel
                </Button>
                <Button onClick={() => setShowAddForm(true)} className="h-11 sm:h-12 text-base">
                  <Plus className="w-5 h-5 mr-2" />
                  Add First Player
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-5">
            {players.map((player) => (
              <PlayerCard
                key={player._id}
                player={player}
                isCaptain={captainPlayerIds.has(player._id)}
                categories={tournament?.settings.categories}
                onClick={() => setSelectedPlayer(player)}
              />
            ))}
          </div>
        )}

        {/* Player Details Modal */}
        {selectedPlayer && (
          <PlayerDetailsModal
            player={selectedPlayer}
            teamName={getTeamName(selectedPlayer.teamId)}
            onClose={() => setSelectedPlayer(null)}
          />
        )}

        {/* Import Modal */}
        {showImport && (
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4"
            onClick={() => setShowImport(false)}
          >
            <div
              className="bg-slate-900 border border-slate-700 rounded-xl max-w-4xl w-full max-h-[90dvh] flex flex-col overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-700 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Upload className="w-5 h-5 text-blue-400 shrink-0" />
                  <h2 className="text-lg sm:text-xl font-bold truncate">Import Players</h2>
                </div>
                <button
                  onClick={() => setShowImport(false)}
                  aria-label="Close import players"
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition touch-target shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable body */}
              <div className="overflow-y-auto ipad-scroll px-4 sm:px-6 py-4 sm:py-5">
                <PlayerImport
                  tournamentId={tournamentId}
                  onComplete={() => setShowImport(false)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Add Player Form */}
        {showAddForm && (
          <PlayerForm
            tournamentId={tournamentId}
            onClose={() => setShowAddForm(false)}
          />
        )}

        {/* Delete All Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-red-500/20 rounded-full">
                  <AlertTriangle className="w-6 h-6 text-red-500" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Delete All Players</h3>
                  <p className="text-slate-400 text-sm">This action cannot be undone</p>
                </div>
              </div>

              <div className="bg-slate-800/50 rounded-lg p-4 mb-6">
                <p className="text-slate-300 mb-3">
                  Are you sure you want to delete all players from this tournament?
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total players:</span>
                    <span className="font-semibold">{stats.total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Pending (will be deleted):</span>
                    <span className="font-semibold text-red-400">{stats.pending}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Unsold (will be deleted):</span>
                    <span className="font-semibold text-red-400">{stats.unsold}</span>
                  </div>
                  {stats.sold > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Sold (will be skipped):</span>
                      <span className="font-semibold text-green-400">{stats.sold}</span>
                    </div>
                  )}
                  {stats.inAuction > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">In auction (will be skipped):</span>
                      <span className="font-semibold text-yellow-400">{stats.inAuction}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-red-600 hover:bg-red-700"
                  disabled={isDeleting}
                  onClick={async () => {
                    setIsDeleting(true);
                    try {
                      const result = await deleteAllPlayers({
                        tournamentId,
                        includesSold: false,
                      });
                      toast.success(`Deleted ${result.deletedCount} players`, {
                        description: result.skippedCount > 0
                          ? `${result.skippedCount} players were skipped (sold/in auction)`
                          : undefined,
                      });
                      setShowDeleteConfirm(false);
                    } catch (error) {
                      toast.error('Failed to delete players', {
                        description: error instanceof Error ? error.message : 'Unknown error',
                      });
                    } finally {
                      setIsDeleting(false);
                    }
                  }}
                >
                  {isDeleting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete All
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}