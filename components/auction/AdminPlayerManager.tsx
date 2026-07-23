"use client";

import { useState, useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { X, Search, UserCheck, UserX, ArrowRightLeft, DollarSign, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency, getErrorMessage, getRoleDisplay, getCaptainPlayerIds } from '@/lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { TeamLogo } from '@/components/ui/team-logo';
// Props for the AdminPlayerManager component
interface AdminPlayerManagerProps {
    tournamentId: Id<"tournaments">;
    maxPlayersPerTeam: number;
    tournamentBasePrice: number;
    onClose: () => void;
}

type StatusFilter = 'all' | 'sold' | 'unsold' | 'pending' | 'final_unsold';

// Human-readable label for an auction status (raw values are snake_case).
const statusLabel = (status: string) =>
    status === 'final_unsold' ? 'final unsold' : status;

interface EditState {
    playerId: Id<"players">;
    action: 'status' | 'reassign' | 'price';
    newStatus?: 'sold' | 'unsold' | 'pending';
    newTeamId?: Id<"teams">;
    newPrice?: number;
}

export function AdminPlayerManager({ tournamentId, maxPlayersPerTeam, tournamentBasePrice, onClose }: AdminPlayerManagerProps) {
    const players = useQuery(api.players.listByTournament, { tournamentId });
    const teams = useQuery(api.teams.listByTournament, { tournamentId });

    const updatePlayerStatus = useMutation(api.admin.updatePlayerStatus);
    const reassignPlayer = useMutation(api.admin.reassignPlayer);
    const updateSoldPrice = useMutation(api.admin.updateSoldPrice);

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [editState, setEditState] = useState<EditState | null>(null);
    const [saving, setSaving] = useState(false);

    // Captains are pre-assigned and never auctioned — exclude them from status
    // views and counts (they remain visible under the "All" tab).
    const captainPlayerIds = useMemo(() => getCaptainPlayerIds(teams), [teams]);

    // Filtered and sorted players
    const filteredPlayers = useMemo(() => {
        if (!players) return [];
        let list = [...players];

        // Filter by status (captains excluded from every non-"all" view)
        if (statusFilter !== 'all') {
            list = list.filter(p => p.auctionStatus === statusFilter && !captainPlayerIds.has(p._id));
        }

        // Filter by search
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(p => p.name.toLowerCase().includes(q));
        }

        // Sort: sold first, then unsold, then pending, then final unsold
        const statusOrder: Record<string, number> = { sold: 0, unsold: 1, in_auction: 2, pending: 3, final_unsold: 4 };
        list.sort((a, b) => (statusOrder[a.auctionStatus] ?? 9) - (statusOrder[b.auctionStatus] ?? 9));

        return list;
    }, [players, statusFilter, search, captainPlayerIds]);

    const getTeamName = (teamId?: Id<"teams">) => {
        if (!teamId || !teams) return '—';
        return teams.find(t => t._id === teamId)?.name || '—';
    };

    const getTeam = (teamId?: Id<"teams">) => {
        if (!teamId || !teams) return null;
        return teams.find(t => t._id === teamId) || null;
    };

    const statusBadge = (status: string) => {
        const styles: Record<string, string> = {
            sold: 'bg-green-600/20 text-green-400 border-green-600/30',
            unsold: 'bg-red-600/20 text-red-400 border-red-600/30',
            pending: 'bg-slate-600/20 text-slate-400 border-slate-600/30',
            in_auction: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
            final_unsold: 'bg-red-900/30 text-red-300 border-red-800/40',
        };
        return styles[status] || styles.pending;
    };

    const handleSave = async () => {
        if (!editState) return;
        setSaving(true);

        try {
            if (editState.action === 'status' && editState.newStatus) {
                await updatePlayerStatus({
                    playerId: editState.playerId,
                    newStatus: editState.newStatus,
                    teamId: editState.newStatus === 'sold' ? editState.newTeamId : undefined,
                    soldPrice: editState.newStatus === 'sold' ? editState.newPrice : undefined,
                });
                toast.success(`Player status updated to ${editState.newStatus}`);
            } else if (editState.action === 'reassign' && editState.newTeamId) {
                await reassignPlayer({
                    playerId: editState.playerId,
                    newTeamId: editState.newTeamId,
                    newSoldPrice: editState.newPrice,
                });
                toast.success('Player reassigned successfully');
            } else if (editState.action === 'price' && editState.newPrice !== undefined) {
                await updateSoldPrice({
                    playerId: editState.playerId,
                    newSoldPrice: editState.newPrice,
                });
                toast.success('Sold price updated successfully');
            }

            setEditState(null);
        } catch (error) {
            toast.error(getErrorMessage(error, 'Failed to update player'));
        } finally {
            setSaving(false);
        }
    };

    const startEdit = (playerId: Id<"players">, action: EditState['action'], defaults?: Partial<EditState>) => {
        setEditState({ playerId, action, ...defaults });
    };

    const counts = useMemo(() => {
        if (!players) return { sold: 0, unsold: 0, pending: 0, finalUnsold: 0, total: 0 };
        // Status counts exclude captains; "total" is the full managed roster.
        const auctionable = players.filter(p => !captainPlayerIds.has(p._id));
        return {
            sold: auctionable.filter(p => p.auctionStatus === 'sold').length,
            unsold: auctionable.filter(p => p.auctionStatus === 'unsold').length,
            pending: auctionable.filter(p => p.auctionStatus === 'pending').length,
            finalUnsold: auctionable.filter(p => p.auctionStatus === 'final_unsold').length,
            total: players.length,
        };
    }, [players, captainPlayerIds]);

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-slate-900 border border-slate-700 rounded-xl max-w-4xl w-full p-5 sm:p-6 my-auto"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                    <div>
                        <h2 className="text-xl sm:text-2xl font-bold">Manage Players</h2>
                        <p className="text-sm text-slate-400 mt-1">
                            Change status, reassign teams, or adjust sold prices
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg transition">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Status Filter Tabs */}
                <div className="flex flex-wrap gap-2 mb-4">
                    {([
                        { key: 'all' as StatusFilter, label: 'All', count: counts.total },
                        { key: 'sold' as StatusFilter, label: 'Sold', count: counts.sold },
                        { key: 'unsold' as StatusFilter, label: 'Unsold', count: counts.unsold },
                        { key: 'pending' as StatusFilter, label: 'Pending', count: counts.pending },
                        ...(counts.finalUnsold > 0
                            ? [{ key: 'final_unsold' as StatusFilter, label: 'Final Unsold', count: counts.finalUnsold }]
                            : []),
                    ]).map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setStatusFilter(tab.key)}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${statusFilter === tab.key
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                }`}
                        >
                            {tab.label} ({tab.count})
                        </button>
                    ))}
                </div>

                {/* Search */}
                <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                        placeholder="Search players..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-10 bg-slate-800 border-slate-700"
                    />
                </div>

                {/* Player List */}
                <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
                    {!players ? (
                        <div className="flex justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
                        </div>
                    ) : filteredPlayers.length === 0 ? (
                        <div className="text-center py-12 text-slate-400">
                            <Filter className="w-10 h-10 mx-auto mb-2 opacity-50" />
                            <p>No players match your filters</p>
                        </div>
                    ) : (
                        filteredPlayers.map((player) => {
                            const team = getTeam(player.teamId);
                            const isEditing = editState?.playerId === player._id;

                            return (
                                <div
                                    key={player._id}
                                    className={`bg-slate-800/50 border rounded-lg p-3 transition ${isEditing ? 'border-blue-500 bg-blue-500/5' : 'border-slate-700'
                                        }`}
                                >
                                    {/* Player row */}
                                    <div className="flex items-center gap-3">
                                        {/* Player info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-sm truncate">{player.name}</span>
                                                <span className={`px-2 py-0.5 text-xs rounded border font-medium ${statusBadge(player.auctionStatus)}`}>
                                                    {statusLabel(player.auctionStatus)}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                                                <span>{getRoleDisplay(player.role)}</span>
                                                {player.auctionStatus === 'sold' && team && (
                                                    <>
                                                        <span>•</span>
                                                        <span className="flex items-center gap-1">
                                                            <TeamLogo name={team.name} logoUrl={team.logoUrl} primaryColor={team.colorPrimary} size="sm" />
                                                            {team.name}
                                                        </span>
                                                        <span>•</span>
                                                        <span className="text-green-400 font-medium">{formatCurrency(player.soldPrice || 0)}</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Action buttons */}
                                        {player.auctionStatus !== 'in_auction' && !isEditing && (
                                            <div className="flex gap-1 shrink-0">
                                                {player.auctionStatus === 'sold' ? (
                                                    <>
                                                        <button
                                                            onClick={() => startEdit(player._id, 'status', { newStatus: 'unsold' })}
                                                            className="p-1.5 rounded-lg bg-red-600/10 text-red-400 hover:bg-red-600/20 transition"
                                                            title="Mark as Unsold"
                                                        >
                                                            <UserX className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => startEdit(player._id, 'reassign', {
                                                                newTeamId: player.teamId,
                                                                newPrice: player.soldPrice,
                                                            })}
                                                            className="p-1.5 rounded-lg bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 transition"
                                                            title="Reassign Team"
                                                        >
                                                            <ArrowRightLeft className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => startEdit(player._id, 'price', {
                                                                newPrice: player.soldPrice,
                                                            })}
                                                            className="p-1.5 rounded-lg bg-yellow-600/10 text-yellow-400 hover:bg-yellow-600/20 transition"
                                                            title="Change Price"
                                                        >
                                                            <DollarSign className="w-4 h-4" />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button
                                                            onClick={() => startEdit(player._id, 'status', {
                                                                newStatus: 'sold',
                                                                newPrice: player.basePrice ?? 100000,
                                                            })}
                                                            className="p-1.5 rounded-lg bg-green-600/10 text-green-400 hover:bg-green-600/20 transition"
                                                            title="Mark as Sold"
                                                        >
                                                            <UserCheck className="w-4 h-4" />
                                                        </button>
                                                        {(player.auctionStatus === 'unsold' || player.auctionStatus === 'final_unsold') && (
                                                            <button
                                                                onClick={() => startEdit(player._id, 'status', { newStatus: 'pending' })}
                                                                className="p-1.5 rounded-lg bg-slate-600/10 text-slate-400 hover:bg-slate-600/20 transition"
                                                                title="Return to Pending"
                                                            >
                                                                <ArrowRightLeft className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Edit panel */}
                                    <AnimatePresence>
                                        {isEditing && editState && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="mt-3 pt-3 border-t border-slate-700 space-y-3">
                                                    {/* Status change: unsold → confirm */}
                                                    {editState.action === 'status' && editState.newStatus === 'unsold' && (
                                                        <p className="text-sm text-amber-400">
                                                            ⚠️ This will mark the player as unsold and refund {formatCurrency(players.find(p => p._id === editState.playerId)?.soldPrice || 0)} to {getTeamName(players.find(p => p._id === editState.playerId)?.teamId)}.
                                                        </p>
                                                    )}

                                                    {/* Status change: pending → confirm */}
                                                    {editState.action === 'status' && editState.newStatus === 'pending' && (
                                                        <p className="text-sm text-slate-400">
                                                            This will return the player to the auction pool.
                                                        </p>
                                                    )}

                                                    {/* Mark as sold: team + price */}
                                                    {editState.action === 'status' && editState.newStatus === 'sold' && (() => {
                                                        const selectedTeam = editState.newTeamId ? teams?.find(t => t._id === editState.newTeamId) : null;
                                                        const teamPlayerCount = selectedTeam ? (players?.filter(p => p.teamId === selectedTeam._id && p.auctionStatus === 'sold').length || 0) : 0;
                                                        const slotsNeeded = maxPlayersPerTeam - teamPlayerCount - 1; // -1 for this player
                                                        const purseAfter = selectedTeam ? selectedTeam.purseRemaining - (editState.newPrice || 0) : 0;
                                                        const basePrice = tournamentBasePrice;
                                                        const canFillSquad = !selectedTeam || slotsNeeded <= 0 || purseAfter >= slotsNeeded * basePrice;
                                                        const insufficientPurse = selectedTeam && (editState.newPrice || 0) > selectedTeam.purseRemaining;

                                                        return (
                                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                                <div>
                                                                    <label className="text-xs text-slate-400 mb-1 block">Assign to Team</label>
                                                                    <select
                                                                        value={editState.newTeamId || ''}
                                                                        onChange={(e) => setEditState({ ...editState, newTeamId: e.target.value as Id<"teams"> })}
                                                                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                                                                    >
                                                                        <option value="">Select team...</option>
                                                                        {teams?.map(t => (
                                                                            <option key={t._id} value={t._id}>
                                                                                {t.name} (₹{(t.purseRemaining / 100000).toFixed(1)}L left)
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className="text-xs text-slate-400 mb-1 block">Sold Price (₹)</label>
                                                                    <Input
                                                                        type="number"
                                                                        value={editState.newPrice || ''}
                                                                        onChange={(e) => setEditState({ ...editState, newPrice: parseInt(e.target.value) || 0 })}
                                                                        className={`bg-slate-800 border-slate-600 ${insufficientPurse ? 'border-red-500' : ''}`}
                                                                        min={0}
                                                                        step={5000}
                                                                    />
                                                                </div>
                                                                {insufficientPurse && (
                                                                    <p className="text-xs text-red-400 col-span-full">
                                                                        ⛔ Team only has {formatCurrency(selectedTeam!.purseRemaining)} remaining — insufficient for this price.
                                                                    </p>
                                                                )}
                                                                {!insufficientPurse && selectedTeam && !canFillSquad && (
                                                                    <p className="text-xs text-amber-400 col-span-full">
                                                                        ⚠️ After this, {selectedTeam.name} will have {formatCurrency(purseAfter)} left but needs {formatCurrency(slotsNeeded * basePrice)} to fill {slotsNeeded} more slot(s) at base price.
                                                                    </p>
                                                                )}
                                                            </div>
                                                        );
                                                    })()}

                                                    {/* Reassign: new team + optional new price */}
                                                    {editState.action === 'reassign' && (() => {
                                                        const selectedTeam = editState.newTeamId ? teams?.find(t => t._id === editState.newTeamId) : null;
                                                        const teamPlayerCount = selectedTeam ? (players?.filter(p => p.teamId === selectedTeam._id && p.auctionStatus === 'sold').length || 0) : 0;
                                                        const slotsNeeded = maxPlayersPerTeam - teamPlayerCount - 1;
                                                        const purseAfter = selectedTeam ? selectedTeam.purseRemaining - (editState.newPrice || 0) : 0;
                                                        const basePrice = tournamentBasePrice;
                                                        const canFillSquad = !selectedTeam || slotsNeeded <= 0 || purseAfter >= slotsNeeded * basePrice;
                                                        const insufficientPurse = selectedTeam && (editState.newPrice || 0) > selectedTeam.purseRemaining;

                                                        return (
                                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                                <div>
                                                                    <label className="text-xs text-slate-400 mb-1 block">New Team</label>
                                                                    <select
                                                                        value={editState.newTeamId || ''}
                                                                        onChange={(e) => setEditState({ ...editState, newTeamId: e.target.value as Id<"teams"> })}
                                                                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                                                                    >
                                                                        <option value="">Select team...</option>
                                                                        {teams?.filter(t => t._id !== player.teamId).map(t => (
                                                                            <option key={t._id} value={t._id}>
                                                                                {t.name} (₹{(t.purseRemaining / 100000).toFixed(1)}L left)
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className="text-xs text-slate-400 mb-1 block">Sold Price (₹)</label>
                                                                    <Input
                                                                        type="number"
                                                                        value={editState.newPrice || ''}
                                                                        onChange={(e) => setEditState({ ...editState, newPrice: parseInt(e.target.value) || 0 })}
                                                                        className={`bg-slate-800 border-slate-600 ${insufficientPurse ? 'border-red-500' : ''}`}
                                                                        min={0}
                                                                        step={5000}
                                                                    />
                                                                </div>
                                                                {insufficientPurse && (
                                                                    <p className="text-xs text-red-400 col-span-full">
                                                                        ⛔ Team only has {formatCurrency(selectedTeam!.purseRemaining)} remaining — insufficient for this price.
                                                                    </p>
                                                                )}
                                                                {!insufficientPurse && selectedTeam && !canFillSquad && (
                                                                    <p className="text-xs text-amber-400 col-span-full">
                                                                        ⚠️ After this, {selectedTeam.name} will have {formatCurrency(purseAfter)} left but needs {formatCurrency(slotsNeeded * basePrice)} to fill {slotsNeeded} more slot(s) at base price.
                                                                    </p>
                                                                )}
                                                            </div>
                                                        );
                                                    })()}

                                                    {/* Change price only */}
                                                    {editState.action === 'price' && (() => {
                                                        const currentPlayer = players?.find(p => p._id === editState.playerId);
                                                        const team = currentPlayer?.teamId ? teams?.find(t => t._id === currentPlayer.teamId) : null;
                                                        const oldPrice = currentPlayer?.soldPrice || 0;
                                                        const priceDiff = (editState.newPrice || 0) - oldPrice;
                                                        const teamPlayerCount = team ? (players?.filter(p => p.teamId === team._id && p.auctionStatus === 'sold').length || 0) : 0;
                                                        const slotsNeeded = maxPlayersPerTeam - teamPlayerCount;
                                                        const purseAfter = team ? team.purseRemaining - priceDiff : 0;
                                                        const basePrice = tournamentBasePrice;
                                                        const canFillSquad = !team || slotsNeeded <= 0 || purseAfter >= slotsNeeded * basePrice;
                                                        const insufficientPurse = team && priceDiff > 0 && priceDiff > team.purseRemaining;

                                                        return (
                                                            <div className="max-w-xs space-y-2">
                                                                <div>
                                                                    <label className="text-xs text-slate-400 mb-1 block">New Sold Price (₹)</label>
                                                                    <Input
                                                                        type="number"
                                                                        value={editState.newPrice || ''}
                                                                        onChange={(e) => setEditState({ ...editState, newPrice: parseInt(e.target.value) || 0 })}
                                                                        className={`bg-slate-800 border-slate-600 ${insufficientPurse ? 'border-red-500' : ''}`}
                                                                        min={0}
                                                                        step={5000}
                                                                    />
                                                                </div>
                                                                {priceDiff !== 0 && team && (
                                                                    <p className="text-xs text-slate-400">
                                                                        {priceDiff > 0 ? `+${formatCurrency(priceDiff)}` : formatCurrency(priceDiff)} → Purse will be {formatCurrency(purseAfter)}
                                                                    </p>
                                                                )}
                                                                {insufficientPurse && (
                                                                    <p className="text-xs text-red-400">
                                                                        ⛔ Team only has {formatCurrency(team!.purseRemaining)} remaining.
                                                                    </p>
                                                                )}
                                                                {!insufficientPurse && team && !canFillSquad && (
                                                                    <p className="text-xs text-amber-400">
                                                                        ⚠️ After this, team will have {formatCurrency(purseAfter)} left but needs {formatCurrency(slotsNeeded * basePrice)} to fill {slotsNeeded} slot(s).
                                                                    </p>
                                                                )}
                                                            </div>
                                                        );
                                                    })()}

                                                    {/* Action buttons */}
                                                    <div className="flex gap-2">
                                                        <Button
                                                            size="sm"
                                                            onClick={handleSave}
                                                            disabled={saving || (
                                                                editState.action === 'status' && editState.newStatus === 'sold' && (!editState.newTeamId || !editState.newPrice)
                                                            ) || (
                                                                    editState.action === 'reassign' && !editState.newTeamId
                                                                )}
                                                            className="text-xs"
                                                        >
                                                            {saving ? 'Saving...' : 'Confirm'}
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => setEditState(null)}
                                                            className="text-xs"
                                                        >
                                                            Cancel
                                                        </Button>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer */}
                <div className="mt-5 pt-4 border-t border-slate-700 flex justify-end">
                    <Button onClick={onClose} variant="outline">
                        Close
                    </Button>
                </div>
            </motion.div>
        </div>
    );
}
