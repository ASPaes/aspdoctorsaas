import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { X, Send, StopCircle, Headphones, Trash2, RotateCcw } from "lucide-react";
import type { MediaSendParams } from "./types";
import { useToast } from "@/hooks/use-toast";

interface AudioRecorderProps {
  onSend: (params: MediaSendParams) => void;
  onCancel: () => void;
}

export const AudioRecorder = ({ onSend, onCancel }: AudioRecorderProps) => {
  const [duration, setDuration] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    startRecording();
    return () => {
      stopRecording();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorder.start();
      setIsRecording(true);
      timerRef.current = setInterval(() => setDuration(prev => prev + 1), 1000);
    } catch (error) {
      toast({ title: "Erro ao gravar áudio", description: "Não foi possível acessar o microfone.", variant: "destructive" });
      onCancel();
    }
  };

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
  };

  const handleStopRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) return;
    mediaRecorderRef.current.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      setAudioBlob(blob);
      setAudioUrl(URL.createObjectURL(blob));
      setIsPreviewing(true);
    };
    mediaRecorderRef.current.stop();
    stopRecording();
    setIsRecording(false);
  };

  const handleRerecord = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null); setAudioUrl(null); setIsPreviewing(false); setDuration(0);
    startRecording();
  };

  const handleConfirmSend = () => {
    if (!audioBlob) return;
    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = () => {
      onSend({ messageType: 'audio', mediaBase64: reader.result as string, mediaMimetype: 'audio/webm' });
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  };

  const handleCancel = () => {
    if (mediaRecorderRef.current && isRecording) mediaRecorderRef.current.stop();
    stopRecording();
    onCancel();
  };

  const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;

  if (isPreviewing && audioUrl) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <div className="flex items-center gap-2">
          <Headphones className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Áudio gravado</span>
          <span className="text-sm text-muted-foreground">{formatDuration(duration)}</span>
        </div>
        <audio src={audioUrl} controls className="w-full h-10 rounded" />
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={handleCancel}><Trash2 className="w-4 h-4 mr-2" />Descartar</Button>
          <Button variant="outline" size="sm" onClick={handleRerecord}><RotateCcw className="w-4 h-4 mr-2" />Regravar</Button>
          <Button size="sm" onClick={handleConfirmSend}><Send className="w-4 h-4 mr-2" />Enviar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 py-2">
      <div className="flex items-center gap-2 flex-1">
        <div className="w-3 h-3 rounded-full bg-destructive animate-pulse" />
        <span className="text-sm font-medium">Gravando...</span>
        <span className="text-sm text-muted-foreground">{formatDuration(duration)}</span>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleCancel}><X className="w-4 h-4 mr-2" />Cancelar</Button>
        <Button size="sm" onClick={handleStopRecording} disabled={duration < 1}><StopCircle className="w-4 h-4 mr-2" />Parar</Button>
      </div>
    </div>
  );
};
