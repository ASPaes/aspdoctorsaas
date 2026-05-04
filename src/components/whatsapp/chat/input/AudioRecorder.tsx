import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { X, Send, StopCircle, Headphones, Trash2, RotateCcw } from "lucide-react";
import type { MediaSendParams } from "./types";
import { useToast } from "@/hooks/use-toast";
// @ts-ignore — opus-recorder não tem tipos TS
import Recorder from "opus-recorder";
// Vite resolve `?url` e copia o worker pro bundle
// @ts-ignore
import encoderWorkerUrl from "opus-recorder/dist/encoderWorker.min.js?url";

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
  const recorderRef = useRef<any>(null);
  const chunksRef = useRef<Uint8Array[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    startRecording();
    return () => {
      cleanupRecorder();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanupRecorder = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current) {
      try {
        recorderRef.current.stop();
      } catch {}
      try {
        recorderRef.current.close?.();
      } catch {}
      recorderRef.current = null;
    }
  };

  const startRecording = async () => {
    try {
      chunksRef.current = [];
      const recorder = new Recorder({
        encoderPath: encoderWorkerUrl,
        encoderApplication: 2049, // VoIP/voice
        encoderFrameSize: 20,
        encoderSampleRate: 48000,
        numberOfChannels: 1, // mono — Meta requer mono pra ogg/opus
        streamPages: false,
        recordingGain: 1,
      });

      recorder.ondataavailable = (typedArray: Uint8Array) => {
        chunksRef.current.push(typedArray);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current as BlobPart[], { type: "audio/ogg" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setIsPreviewing(true);
      };

      await recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
      timerRef.current = setInterval(
        () => setDuration((prev) => prev + 1),
        1000,
      );
    } catch (error) {
      console.error("[AudioRecorder] Erro ao iniciar gravação:", error);
      toast({
        title: "Erro ao gravar áudio",
        description: "Não foi possível acessar o microfone.",
        variant: "destructive",
      });
      onCancel();
    }
  };

  const handleStopRecording = () => {
    if (!recorderRef.current || !isRecording) return;
    try {
      recorderRef.current.stop();
    } catch (err) {
      console.error("[AudioRecorder] Erro ao parar:", err);
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
  };

  const handleRerecord = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setIsPreviewing(false);
    setDuration(0);
    startRecording();
  };

  const handleConfirmSend = async () => {
    if (!audioBlob) return;
    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = () => {
      onSend({
        messageType: "audio",
        mediaBase64: reader.result as string,
        mediaMimetype: "audio/ogg",
      });
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  };

  const handleCancel = () => {
    cleanupRecorder();
    onCancel();
  };

  const formatDuration = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;

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
