"use client";

import { use, useCallback, useMemo, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Doc, Id } from '@/convex/_generated/dataModel';
import Link from 'next/link';
import { ArrowLeft, Plus, Upload, Users, Trash2, AlertTriangle, Download, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/Navbar';
import { PlayerCard } from '@/components/players/PlayerCard';
import { PlayerImport } from '@/components/players/PlayerImport';
import { PlayerForm } from '@/components/players/PlayerForm';
import { PlayerDetailsModal } from '@/components/players/PlayerDetailsModal';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import { getPlayerInitials } from '@/lib/utils';
import { useUserRole } from '@/hooks/useUserRole';

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
  const [selectedPlayer, setSelectedPlayer] = useState<Doc<"players"> | null>(null);
  const tournament = useQuery(api.tournaments.getById, { id: tournamentId });
  const allPlayers = useQuery(api.players.listByTournament, { tournamentId });
  const teams = useQuery(api.teams.listByTournament, { tournamentId });
  const deleteAllPlayers = useMutation(api.players.deleteAllByTournament);
  const { isAdmin } = useUserRole();

  // Get team name for a player
  const getTeamName = useCallback((teamId?: Id<"teams">) => {
    if (!teamId || !teams) return undefined;
    return teams.find(t => t._id === teamId)?.name;
  }, [teams]);

  const players = allPlayers?.filter(p => 
    {const statusMatch = filterStatus === 'all' || p.auctionStatus === filterStatus;
    const roleMatch = filterRole === 'all' || p.role === filterRole;
    return statusMatch && roleMatch;}
  );

  const stats = useMemo(() => ({
    total: allPlayers?.length || 0,
    pending: allPlayers?.filter(p => p.auctionStatus === 'pending').length || 0,
    inAuction: allPlayers?.filter(p => p.auctionStatus === 'in_auction').length || 0,
    sold: allPlayers?.filter(p => p.auctionStatus === 'sold').length || 0,
    unsold: allPlayers?.filter(p => p.auctionStatus === 'unsold').length || 0,
    batters: allPlayers?.filter(p => p.role === 'Batter').length || 0,
    bowlers: allPlayers?.filter(p => p.role === 'Bowler').length || 0,
    allRounders: allPlayers?.filter(p => p.role === 'All-Rounder').length || 0,
  }), [allPlayers]);

  // Download all players as PDF
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  const handleDownloadAllPlayers = useCallback(async () => {
    if (!allPlayers || allPlayers.length === 0) {
      toast.error('No players to download');
      return;
    }

    setIsGeneratingPDF(true);
    toast.info('Generating PDF with player photos...');

    try {
      // Pre-load all player images
      const imageCache: Record<string, string> = {};
      
      const loadImage = (url: string): Promise<string | null> => {
        return new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
              } else {
                resolve(null);
              }
            } catch {
              resolve(null);
            }
          };
          img.onerror = () => resolve(null);
          // Add timestamp to bypass cache issues
          img.src = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
        });
      };

      // Load all images in parallel
      const imagePromises = allPlayers
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
      const margin = 15;
      const contentWidth = pageWidth - 2 * margin;

      // Card dimensions - 2 players per row
      const cardWidth = (contentWidth - 10) / 2; // 10mm gap between cards
      const cardHeight = 55;
      const cardsPerPage = 8; // 2 columns x 4 rows
      const photoSize = 18; // Photo size in mm

      // Helper to draw a player card
      const drawPlayerCard = (player: Doc<"players">, x: number, y: number) => {
        // Card background
        pdf.setFillColor(30, 41, 59); // slate-800
        pdf.roundedRect(x, y, cardWidth, cardHeight, 3, 3, 'F');

        // Role color stripe on left
        const roleColor = player.role === 'Batter' ? [59, 130, 246] : // blue
                          player.role === 'Bowler' ? [249, 115, 22] : // orange
                          player.role.includes('All') ? [147, 51, 234] : // purple
                          [34, 197, 94]; // green
        pdf.setFillColor(roleColor[0], roleColor[1], roleColor[2]);
        pdf.roundedRect(x, y, 4, cardHeight, 3, 0, 'F');
        pdf.rect(x + 2, y, 2, cardHeight, 'F');

        // Player photo or initials
        const photoX = x + 7;
        const photoY = y + 4;
        
        if (imageCache[player._id]) {
          // Draw the photo
          try {
            pdf.addImage(imageCache[player._id], 'JPEG', photoX, photoY, photoSize, photoSize);
          } catch {
            // If image fails, draw initials
            drawInitials(player, photoX, photoY);
          }
        } else {
          // Draw initials placeholder
          drawInitials(player, photoX, photoY);
        }

        // Helper function to draw initials
        function drawInitials(p: Doc<"players">, px: number, py: number) {
          // Gradient background for initials
          pdf.setFillColor(59, 130, 246); // blue-600
          pdf.roundedRect(px, py, photoSize, photoSize, 2, 2, 'F');
          
          // Initials text
          pdf.setTextColor(255, 255, 255);
          pdf.setFontSize(10);
          pdf.setFont('helvetica', 'bold');
          const initials = getPlayerInitials(p.name);
          pdf.text(initials, px + photoSize / 2, py + photoSize / 2 + 3, { align: 'center' });
        }

        // Text content starts after the photo
        const textX = x + 7 + photoSize + 4;
        const textWidth = cardWidth - photoSize - 15;

        // Player name
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        const maxNameLength = Math.floor(textWidth / 2);
        const truncatedName = player.name.length > maxNameLength ? player.name.substring(0, maxNameLength - 2) + '...' : player.name;
        pdf.text(truncatedName, textX, y + 8);

        // Role badge
        pdf.setFillColor(roleColor[0], roleColor[1], roleColor[2]);
        pdf.setFontSize(6);
        const roleWidth = pdf.getTextWidth(player.role) + 4;
        pdf.roundedRect(textX, y + 10, roleWidth, 4, 1, 1, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.text(player.role, textX + 2, y + 13);

        //Status badge
        const statusColor = player.auctionStatus === 'sold' ? [34, 197, 94] : // green
                            player.auctionStatus === 'unsold' ? [239, 68, 68] : // red
                            player.auctionStatus === 'in_auction' ? [234, 179, 8] : // yellow
                            [100, 116, 139]; // slate
        pdf.setFillColor(statusColor[0], statusColor[1], statusColor[2]);
        const statusText = statusLabels[player.auctionStatus] || player.auctionStatus;
        const statusWidth = pdf.getTextWidth(statusText) + 4;
        pdf.roundedRect(textX + roleWidth + 2, y + 10, statusWidth, 4, 1, 1, 'F');
        pdf.text(statusText, textX + roleWidth + 4, y + 13);

        // Age on right side of photo area
        pdf.setFontSize(7);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`${player.age} yrs`, textX, y + 19);

        // Details section below photo
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'normal');
        let detailY = y + 26;

        //Base Price & Sold Price
        pdf.setTextColor(148, 163, 184);
        pdf.text('Base:', x + 8, detailY);
        pdf.setTextColor(34, 197, 94); // green
        pdf.text(formatCurrency(player.basePrice), x + 18, detailY);

        if (player.soldPrice) {
          pdf.setTextColor(148, 163, 184);
          pdf.text('Sold:', x + cardWidth / 2, detailY);
          pdf.setTextColor(234, 179, 8); // yellow
          pdf.text(formatCurrency(player.soldPrice), x + cardWidth / 2 + 10, detailY);
        } else {
          // Style
          pdf.setTextColor(148, 163, 184);
          pdf.text('Style:', x + cardWidth / 2, detailY);
          pdf.setTextColor(255, 255, 255);
          const styleShort = player.battingBowlingHand.includes('Right') ? 'Right' : 'Left';
          pdf.text(styleShort, x + cardWidth / 2 + 12, detailY);
        }

        detailY += 6;

        // Team (if sold) or Phone
        if (player.teamId) {
          const teamName = getTeamName(player.teamId);
          if (teamName) {
            pdf.setTextColor(148, 163, 184);
            pdf.text('Team:', x + 8, detailY);
            pdf.setTextColor(59, 130, 246);
            const truncatedTeam = teamName.length > 22 ? teamName.substring(0, 20) + '...' : teamName;
            pdf.text(truncatedTeam, x + 18, detailY);
          }
        } else if (player.phoneNumber) {
          pdf.setTextColor(148, 163, 184);
          pdf.text('Phone:', x + 8, detailY);
          pdf.setTextColor(255, 255, 255);
          pdf.text(player.phoneNumber, x + 20, detailY);
        }

        detailY += 6;

        // Jersey & T-Shirt
        if (player.jerseyNumber) {
          pdf.setTextColor(148, 163, 184);
          pdf.text('Jersey:', x + 8, detailY);
          pdf.setTextColor(255, 255, 255);
          pdf.text(`#${player.jerseyNumber}`, x + 20, detailY);
        }
        if (player.tshirtSize) {
          pdf.setTextColor(148, 163, 184);
          pdf.text('Size:', x + cardWidth / 2, detailY);
          pdf.setTextColor(255, 255, 255);
          pdf.text(player.tshirtSize, x + cardWidth / 2 + 10, detailY);
        }
      };

      // Draw each page
      const totalPages = Math.ceil(allPlayers.length / cardsPerPage);
      
      for (let page = 0; page < totalPages; page++) {
        if (page > 0) {
          pdf.addPage();
        }

        // Page background
        pdf.setFillColor(15, 23, 42); // slate-900
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');

        // Header accent bar
        pdf.setFillColor(59, 130, 246); // blue-500
        pdf.rect(0, 0, pageWidth, 6, 'F');

        // Title
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(18);
        pdf.setFont('helvetica', 'bold');
        pdf.text('ALL PLAYERS', pageWidth / 2, 18, { align: 'center' });

        // Tournament name
        if (tournament?.name) {
          pdf.setFontSize(10);
          pdf.setTextColor(148, 163, 184);
          pdf.setFont('helvetica', 'normal');
          pdf.text(tournament.name, pageWidth / 2, 25, { align: 'center' });
        }

        // Stats summary
        pdf.setFontSize(8);
        pdf.setTextColor(100, 116, 139);
        pdf.text(
          `Total: ${stats.total} | Batters: ${stats.batters} | Bowlers: ${stats.bowlers} | All-Rounders: ${stats.allRounders} | Sold: ${stats.sold} | Unsold: ${stats.unsold}`,
          pageWidth / 2, 32, { align: 'center' }
        );

        // Page number
        pdf.text(`Page ${page + 1} of ${totalPages}`, pageWidth / 2, pageHeight - 8, { align: 'center' });

        // Draw player cards
        const startIdx = page * cardsPerPage;
        const endIdx = Math.min(startIdx + cardsPerPage, allPlayers.length);
        
        for (let i = startIdx; i < endIdx; i++) {
          const player = allPlayers[i];
          const cardIndex = i - startIdx;
          const col = cardIndex % 2;
          const row = Math.floor(cardIndex / 2);
          
          const x = margin + col * (cardWidth + 10);
          const y = 40 + row * (cardHeight + 8);
          
          drawPlayerCard(player, x, y);
        }
      }

      // Footer on last page
      pdf.setFontSize(8);
      pdf.setTextColor(100, 116, 139);
      pdf.text(
        `Generated on ${new Date().toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        })}`,
        pageWidth / 2,
        pageHeight - 14,
        { align: 'center' }
      );

      // Save the PDF
      const fileName = `${tournament?.name?.replace(/\s+/g, '_') || 'Tournament'}_All_Players.pdf`;
      pdf.save(fileName);
      toast.success(`Downloaded ${allPlayers.length} players as PDF`);
    } catch (error) {
      console.error('PDF generation error:', error);
      toast.error('Failed to generate PDF');
    } finally {
      setIsGeneratingPDF(false);
    }
  }, [allPlayers, tournament, getTeamName, stats]);

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
              {!isAdmin && (
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/60 rounded-lg border border-slate-700 h-11">
                  <Eye className="w-4 h-4 text-blue-400" />
                  <span className="text-sm text-slate-300">Viewer Mode</span>
                </div>
              )}
              
              {stats.total > 0 && isAdmin && (
                <>
                  <Button 
                    variant="outline" 
                    onClick={handleDownloadAllPlayers}
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
              {isAdmin && (
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

        {/* Filters */}
        {/* <div className="flex items-center gap-3 mb-6">
          <Filter className="w-5 h-5 text-slate-400" />
          <div className="flex gap-2">
            {['all', 'Batter', 'Bowler', 'All-Rounder'].map((role) => (
              <button
                key={role}
                onClick={() => setFilterRole(role)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  filterRole === role
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {role === 'all' ? 'All Players' : role}
              </button>
            ))}
          </div>
        </div> */}

      {/* Stats - Status Based */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-6 overflow-x-auto pb-2 ipad-scroll">
          {/* Status Filters */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <span className="text-xs sm:text-sm text-slate-400 mr-1">Status:</span>
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${
                filterStatus === 'all' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              All ({stats.total})
            </button>
            <button
              onClick={() => setFilterStatus('pending')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${
                filterStatus === 'pending' 
                  ? 'bg-slate-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              Pending ({stats.pending})
            </button>
            <button
              onClick={() => setFilterStatus('in_auction')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${
                filterStatus === 'in_auction' 
                  ? 'bg-yellow-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              In Auction ({stats.inAuction})
            </button>
            <button
              onClick={() => setFilterStatus('sold')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${
                filterStatus === 'sold' 
                  ? 'bg-green-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              Sold ({stats.sold})
            </button>
            <button
              onClick={() => setFilterStatus('unsold')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${
                filterStatus === 'unsold' 
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
            <button
              onClick={() => setFilterRole(filterRole === 'all' ? 'all' : 'all')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${
                filterRole === 'all' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
              // Hide this if already showing all
              style={{ display: filterRole === 'all' ? 'none' : 'block' }}
            >
              All
            </button>
            <button
              onClick={() => setFilterRole(filterRole === 'Batter' ? 'all' : 'Batter')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${
                filterRole === 'Batter' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              Batters ({stats.batters})
            </button>
            <button
              onClick={() => setFilterRole(filterRole === 'Bowler' ? 'all' : 'Bowler')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${
                filterRole === 'Bowler' 
                  ? 'bg-red-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              Bowlers ({stats.bowlers})
            </button>
            <button
              onClick={() => setFilterRole(filterRole === 'All-Rounder' ? 'all' : 'All-Rounder')}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition touch-target ${
                filterRole === 'All-Rounder' 
                  ? 'bg-purple-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              All-Rounders ({stats.allRounders})
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
          <div className="text-center py-12 sm:py-16 lg:py-20">
            <Users className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 text-slate-700" />
            <h3 className="text-lg sm:text-xl font-semibold mb-2">No players yet</h3>
            <p className="text-slate-400 mb-6 text-sm sm:text-base px-4">
              {filterRole === 'all' 
                ? 'Add players or import from Excel to get started'
                : `No ${filterRole}s found. Try a different filter.`
              }
            </p>
            {filterRole === 'all' && (
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
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-5">
            {players.map((player) => (
              <PlayerCard 
                key={player._id} 
                player={player} 
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
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto ipad-scroll">
            <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-4xl w-full p-4 sm:p-6 my-4 sm:my-8">
              <PlayerImport
                tournamentId={tournamentId}
                onComplete={() => setShowImport(false)}
              />
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