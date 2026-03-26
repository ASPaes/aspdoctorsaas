import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pause, Clock, Loader2 } from "lucide-react";
import type { PauseReason } from "@/hooks/useAgentPresence";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pauseReasons: PauseReason[];
  onConfirm: (reasonId: string, minutes: number) => Promise<void>;
  loading?: boolean;
}

export function AgentPauseModal({ open, onOpenChange, pauseReasons, onConfirm, loading }: Props) {
  const [selectedReasonId, setSelectedReasonId] = useState<string>("");
  const [minutes, setMinutes] = useState<number>(15);

  const selectedReason = pauseReasons.find(r => r.id === selectedReasonId);

  useEffect(() => {
    if (selectedReason) {
      setMinutes(selectedReason.average_minutes || 15);
    }
  }, [selectedReason]);

  useEffect(() => {
    if (open) {
      setSelectedReasonId("");
      setMinutes(15);
    }
  }, [open]);

  const handleConfirm = () => {
    if (!selectedReasonId || minutes < 1) return;
    onConfirm(selectedReasonId, minutes);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pause className="h-4 w-4" />
            Iniciar Pausa
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Motivo da pausa</Label>
            <Select value={selectedReasonId} onValueChange={setSelectedReasonId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um motivo..." />
              </SelectTrigger>
              <SelectContent>
                {pauseReasons.map(r => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedReason && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Sugestão: {selectedReason.average_minutes} min
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Duração (minutos)</Label>
            <Input
              type="number"
              min={1}
              max={480}
              value={minutes}
              onChange={(e) => setMinutes(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedReasonId || loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Iniciar Pausa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
