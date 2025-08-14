import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Mic, MicOff, Volume2, VolumeX, Phone, PhoneOff, Settings } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface CallState {
  isActive: boolean;
  startTime: number | null;
  duration: string;
  isMuted: boolean;
  speakerEnabled: boolean;
  status: 'idle' | 'connecting' | 'connected' | 'disconnected';
}

interface ConversationMessage {
  speaker: 'AI' | 'User';
  message: string;
  timestamp: number;
}

const AudioCallApp: React.FC = () => {
  const [apiKey, setApiKey] = useState<string>('');
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [showCallModal, setShowCallModal] = useState<boolean>(false);
  const [callState, setCallState] = useState<CallState>({
    isActive: false,
    startTime: null,
    duration: '00:00',
    isMuted: false,
    speakerEnabled: true,
    status: 'idle'
  });
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [isRecording, setIsRecording] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  // Check for saved API key on mount
  useEffect(() => {
    const savedKey = localStorage.getItem('google-ai-live-api-key');
    if (savedKey) {
      setApiKey(savedKey);
      setHasApiKey(true);
    }
  }, []);

  // Timer for call duration
  useEffect(() => {
    if (callState.isActive && callState.startTime) {
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - callState.startTime!;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        const duration = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        setCallState(prev => ({ ...prev, duration }));
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [callState.isActive, callState.startTime]);

  const saveApiKey = useCallback(() => {
    if (!apiKey.trim()) {
      toast({
        title: "Erro",
        description: "Por favor, insira uma chave de API válida",
        variant: "destructive"
      });
      return;
    }

    localStorage.setItem('google-ai-live-api-key', apiKey);
    setHasApiKey(true);
    toast({
      title: "Sucesso",
      description: "Chave de API salva com sucesso",
    });
  }, [apiKey, toast]);

  const connectToLiveAPI = useCallback(async () => {
    try {
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      
      wsRef.current = new WebSocket(wsUrl);
      
      wsRef.current.onopen = () => {
        console.log('WebSocket connected');
        setCallState(prev => ({ ...prev, status: 'connected' }));
        
        // Initialize session
        const setupMessage = {
          setup: {
            model: 'models/gemini-2.0-flash-exp',
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: 'Puck'
                  }
                }
              }
            },
            systemInstruction: {
              parts: [{
                text: "Você é um assistente de IA útil tendo uma conversa por voz. Responda naturalmente e de forma conversacional. Mantenha as respostas concisas, mas envolventes. Você pode ouvir o usuário falando em tempo real."
              }]
            }
          }
        };
        
        wsRef.current?.send(JSON.stringify(setupMessage));
        
        toast({
          title: "Conectado",
          description: "Conexão estabelecida com sucesso",
        });
      };
      
      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.serverContent?.modelTurn?.parts) {
            const parts = data.serverContent.modelTurn.parts;
            
            // Handle text response
            const textPart = parts.find((part: any) => part.text);
            if (textPart) {
              setConversation(prev => [...prev, {
                speaker: 'AI',
                message: textPart.text,
                timestamp: Date.now()
              }]);
            }
            
            // Handle audio response
            const audioPart = parts.find((part: any) => part.inlineData?.mimeType?.startsWith('audio/'));
            if (audioPart && callState.speakerEnabled) {
              playAudioResponse(audioPart.inlineData.data, audioPart.inlineData.mimeType);
            }
          }
          
          if (data.setupComplete) {
            setCallState(prev => ({ ...prev, status: 'connected' }));
          }
          
        } catch (error) {
          console.error('Error handling WebSocket message:', error);
        }
      };
      
      wsRef.current.onclose = () => {
        console.log('WebSocket closed');
        setCallState(prev => ({ ...prev, status: 'disconnected' }));
      };
      
      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setCallState(prev => ({ ...prev, status: 'disconnected' }));
        toast({
          title: "Erro de Conexão",
          description: "Falha ao conectar com a API",
          variant: "destructive"
        });
      };
      
    } catch (error) {
      throw new Error(`Failed to connect to Live API: ${error}`);
    }
  }, [apiKey, callState.speakerEnabled, toast]);

  const playAudioResponse = useCallback((base64Data: string, mimeType: string) => {
    try {
      const audioData = atob(base64Data);
      const audioArray = new Uint8Array(audioData.length);
      
      for (let i = 0; i < audioData.length; i++) {
        audioArray[i] = audioData.charCodeAt(i);
      }
      
      const audioBlob = new Blob([audioArray], { type: mimeType });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.play().then(() => {
        setIsRecording(true);
      });
      
      audio.addEventListener('ended', () => {
        URL.revokeObjectURL(audioUrl);
        setIsRecording(false);
      });
      
    } catch (error) {
      console.error('Error playing audio response:', error);
    }
  }, []);

  const startCall = useCallback(async () => {
    try {
      setShowCallModal(true);
      setCallState(prev => ({ 
        ...prev, 
        isActive: true, 
        startTime: Date.now(),
        status: 'connecting'
      }));
      setConversation([{
        speaker: 'AI',
        message: 'Olá! Estou pronto para nossa conversa por voz. Pode começar a falar!',
        timestamp: Date.now()
      }]);

      // Get user media
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // Connect to Live API
      await connectToLiveAPI();

    } catch (error) {
      console.error('Error starting call:', error);
      toast({
        title: "Erro",
        description: "Falha ao iniciar a chamada",
        variant: "destructive"
      });
      endCall();
    }
  }, [connectToLiveAPI, toast]);

  const endCall = useCallback(() => {
    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    // Update state
    setCallState({
      isActive: false,
      startTime: null,
      duration: '00:00',
      isMuted: false,
      speakerEnabled: true,
      status: 'idle'
    });
    
    setShowCallModal(false);
    setConversation([]);
    setIsRecording(false);
    
    toast({
      title: "Chamada Encerrada",
      description: "A chamada foi finalizada",
    });
  }, [toast]);

  const toggleMute = useCallback(() => {
    setCallState(prev => ({ ...prev, isMuted: !prev.isMuted }));
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = callState.isMuted;
      });
    }
  }, [callState.isMuted]);

  const toggleSpeaker = useCallback(() => {
    setCallState(prev => ({ ...prev, speakerEnabled: !prev.speakerEnabled }));
  }, []);

  const AudioVisualizer: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    return (
      <div className="flex items-end justify-center gap-1 h-16">
        {[...Array(7)].map((_, index) => (
          <div
            key={index}
            className={`audio-bar w-2 rounded-full transition-all duration-300 ${
              isActive ? 'opacity-100' : 'opacity-30'
            }`}
            style={{
              height: isActive ? '100%' : '20%',
              animationPlayState: isActive ? 'running' : 'paused'
            }}
          />
        ))}
      </div>
    );
  };

  if (!hasApiKey) {
    return (
      <div className="min-h-screen bg-gradient-bg flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8 shadow-call">
          <div className="text-center space-y-6">
            <div className="w-20 h-20 bg-gradient-primary rounded-full flex items-center justify-center mx-auto shadow-glow">
              <Settings className="w-10 h-10 text-white" />
            </div>
            
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">AI Audio Call</h1>
              <p className="text-muted-foreground">Conversas por voz com IA</p>
            </div>
            
            <div className="bg-call-bg rounded-xl p-6">
              <h2 className="text-lg font-semibold text-destructive mb-4">Configuração Necessária</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Insira sua chave de API do Google AI Studio para começar as conversas por voz
              </p>
              
              <div className="space-y-4">
                <Input
                  type="password"
                  placeholder="Digite sua chave de API do Google AI Studio"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && saveApiKey()}
                  className="transition-all duration-200"
                />
                
                <Button 
                  onClick={saveApiKey}
                  className="w-full bg-gradient-success hover:scale-105 transition-transform duration-200"
                >
                  Salvar Chave
                </Button>
              </div>
              
              <a
                href="https://makersuite.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-4 text-sm text-primary hover:text-primary-glow transition-colors"
              >
                Obter sua chave de API →
              </a>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-bg flex items-center justify-center p-6">
      <Card className="w-full max-w-md p-8 shadow-call">
        <div className="text-center space-y-8">
          <div className="relative">
            <div className="w-32 h-32 bg-gradient-primary rounded-full flex items-center justify-center mx-auto shadow-glow">
              <div className="text-5xl">🤖</div>
            </div>
            {callState.isActive && (
              <div className="absolute inset-0 rounded-full border-4 border-success animate-pulse" 
                   style={{ animation: 'callPulse 2s infinite' }} />
            )}
          </div>
          
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Assistente de IA</h2>
            <p className="text-success font-medium">Pronto para conversar</p>
          </div>
          
          <Button
            onClick={startCall}
            disabled={callState.isActive}
            className="bg-gradient-success hover:scale-105 transition-all duration-200 text-lg px-8 py-6 rounded-full shadow-glow"
          >
            <Phone className="w-6 h-6 mr-3" />
            Iniciar Chamada de Voz
          </Button>
        </div>
      </Card>

      {/* Call Modal */}
      <Dialog open={showCallModal} onOpenChange={() => {}}>
        <DialogContent className="max-w-md h-[90vh] p-0 bg-white rounded-3xl overflow-hidden">
          {/* Call Header */}
          <div className="bg-gradient-call text-white p-6 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
                  <div className="text-2xl">🤖</div>
                </div>
                <div>
                  <h3 className="text-xl font-semibold">Assistente de IA</h3>
                  <p className="text-white/80 text-sm capitalize">{callState.status}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={endCall}
                className="text-white hover:bg-white/20 rounded-full p-2"
              >
                <PhoneOff className="w-5 h-5" />
              </Button>
            </div>
          </div>

          {/* Call Content */}
          <div className="flex-1 p-6 flex flex-col">
            <div className="text-center mb-6">
              <AudioVisualizer isActive={isRecording || callState.status === 'connected'} />
              <div className="text-3xl font-light text-foreground mt-4">{callState.duration}</div>
            </div>

            {/* Conversation Log */}
            <div className="flex-1 bg-call-bg rounded-xl p-4 mb-6 overflow-y-auto max-h-64">
              <div className="space-y-3">
                {conversation.map((msg, index) => (
                  <div key={index} className="text-sm">
                    <span className={`font-semibold ${
                      msg.speaker === 'AI' ? 'text-primary' : 'text-success'
                    }`}>
                      {msg.speaker}:
                    </span>
                    <span className="ml-2 text-muted-foreground">{msg.message}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Call Controls */}
            <div className="flex justify-center gap-6">
              <Button
                variant="ghost"
                size="lg"
                onClick={toggleMute}
                className={`rounded-full w-16 h-16 ${
                  callState.isMuted 
                    ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' 
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }`}
              >
                {callState.isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </Button>

              <Button
                variant="ghost"
                size="lg"
                onClick={endCall}
                className="rounded-full w-16 h-16 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <PhoneOff className="w-6 h-6" />
              </Button>

              <Button
                variant="ghost"
                size="lg"
                onClick={toggleSpeaker}
                className={`rounded-full w-16 h-16 ${
                  !callState.speakerEnabled 
                    ? 'bg-warning text-warning-foreground hover:bg-warning/90' 
                    : 'bg-muted text-muted-foreground hover:bg-muted/90'
                }`}
              >
                {callState.speakerEnabled ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AudioCallApp;