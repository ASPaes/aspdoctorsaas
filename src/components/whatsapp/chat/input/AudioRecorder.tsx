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
      // WhatsApp requires OGG/Opus format. Use it if supported, fallback to webm.
      const preferredMime = 'audio/ogg;codecs=opus';
      const fallbackMime = 'audio/webm;codecs=opus';
      const mimeToUse = MediaRecorder.isTypeSupported(preferredMime) ? preferredMime : fallbackMime;
      const mediaRecorder = new MediaRecorder(stream, { mimeType: mimeToUse });
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
      const blob = new Blob(chunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'audio/ogg;codecs=opus' });
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

  const handleConfirmSend = async () => {
    if (!audioBlob) return;

    try {
      // Convert WebM to WAV using native Web Audio API
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Get mono channel data
      const samples = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      
      // Encode as WAV
      const wavBuffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(wavBuffer);
      
      // WAV header
      const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
      };
      writeString(0, 'RIFF');
      view.setUint32(4, 36 + samples.length * 2, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, 1, true); // mono
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, samples.length * 2, true);
      
      // Write samples
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
      
      const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
      await audioContext.close();
      
      const reader = new FileReader();
      reader.readAsDataURL(wavBlob);
      reader.onloadend = () => {
        onSend({ messageType: 'audio', mediaBase64: reader.result as string, mediaMimetype: 'audio/wav' });
        if (audioUrl) URL.revokeObjectURL(audioUrl);
      };
    } catch (err) {
      console.error('Audio conversion failed, sending original:', err);
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = () => {
        onSend({ messageType: 'audio', mediaBase64: reader.result as string, mediaMimetype: audioBlob.type });
        if (audioUrl) URL.revokeObjectURL(audioUrl);
      };
    }
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
