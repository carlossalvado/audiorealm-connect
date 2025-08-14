import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
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
        
        // Wait a moment before sending setup message
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
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
            
            console.log('Sending setup message');
            wsRef.current.send(JSON.stringify(setupMessage));
          }
        }, 100);
        
        toast({
          title: "Conectado",
          description: "Conexão estabelecida com sucesso",
        });
      };
      
      wsRef.current.onmessage = (event) => {
        console.log('Received WebSocket message:', event);
        
        // Check if the message is binary (Blob) or text
        if (event.data instanceof Blob) {
          console.log('Received binary audio data, size:', event.data.size);
          // Handle binary audio data - convert to playable format
          const reader = new FileReader();
          reader.onload = () => {
            if (reader.result && callState.speakerEnabled) {
              try {
                // Create audio context for proper playback
                const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                const arrayBuffer = reader.result as ArrayBuffer;
                
                audioContext.decodeAudioData(arrayBuffer)
                  .then(audioBuffer => {
                    const source = audioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(audioContext.destination);
                    
                    source.onended = () => {
                      setIsRecording(false);
                      audioContext.close();
                    };
                    
                    setIsRecording(true);
                    source.start(0);
                    
                    console.log('Audio played successfully');
                  })
                  .catch(decodeError => {
                    console.error('Error decoding audio data:', decodeError);
                    // Fallback: try simple audio playback
                    setIsRecording(false);
                  });
                  
              } catch (error) {
                console.error('Error processing binary audio:', error);
              }
            }
          };
          reader.readAsArrayBuffer(event.data);
          return;
        }

        // Handle text/JSON messages
        try {
          const data = JSON.parse(event.data);
          console.log('Parsed JSON data:', data);
          
          if (data.serverContent?.modelTurn?.parts) {
            const parts = data.serverContent.modelTurn.parts;
            
            // Handle text response
            const textPart = parts.find((part: any) => part.text);
            if (textPart) {
              console.log('Adding AI message:', textPart.text);
              setConversation(prev => [...prev, {
                speaker: 'AI',
                message: textPart.text,
                timestamp: Date.now()
              }]);
            }
            
            // Handle audio response
            const audioPart = parts.find((part: any) => part.inlineData?.mimeType?.startsWith('audio/'));
            if (audioPart && callState.speakerEnabled) {
              console.log('Playing audio response');
              playAudioResponse(audioPart.inlineData.data, audioPart.inlineData.mimeType);
            }
          }
          
          if (data.setupComplete) {
            console.log('Setup completed');
            setCallState(prev => ({ ...prev, status: 'connected' }));
            // Start audio streaming after setup is complete
            if (mediaStreamRef.current && wsRef.current) {
              // Setup audio streaming directly here to avoid circular dependency
              setTimeout(() => {
                if (mediaStreamRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
                  console.log('Setting up audio streaming...');
                  
                  try {
                    const mediaRecorder = new MediaRecorder(mediaStreamRef.current, {
                      mimeType: 'audio/webm;codecs=opus'
                    });
                    
                    mediaRecorder.ondataavailable = (event) => {
                      if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN && !callState.isMuted) {
                        console.log('Sending audio data, size:', event.data.size);
                        sendAudioData(event.data);
                      }
                    };
                    
                    mediaRecorder.start(250);
                    mediaRecorderRef.current = mediaRecorder;
                    
                    console.log('Audio streaming setup completed');
                  } catch (error) {
                    console.error('Error setting up audio streaming:', error);
                  }
                }
              }, 500);
            }
          }
          
        } catch (error) {
          console.error('Error handling WebSocket message:', error);
          console.log('Raw event data:', event.data);
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

  const endCall = useCallback(() => {
    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // Stop media recorder if it exists
    if (mediaRecorderRef.current) {
      const recorder = mediaRecorderRef.current;
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      mediaRecorderRef.current = null;
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

  const playAudioResponse = useCallback((base64Data: string, mimeType: string) => {
    try {
      const audioData = atob(base64Data);
      const audioArray = new Uint8Array(audioData.length);
      
      for (let i = 0; i < audioData.length; i++) {
        audioArray[i] = audioData.charCodeAt(i);
      }
      
      // Try multiple audio formats for compatibility
      const supportedTypes = ['audio/mp3', 'audio/wav', 'audio/ogg', mimeType];
      let audioUrl = null;
      
      for (const type of supportedTypes) {
        try {
          const audioBlob = new Blob([audioArray], { type });
          audioUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(audioUrl);
          
          const playPromise = audio.play();
          
          if (playPromise) {
            playPromise.then(() => {
              setIsRecording(true);
              console.log('Audio playing with type:', type);
            }).catch(err => {
              console.log('Failed with type:', type, err);
              URL.revokeObjectURL(audioUrl);
              audioUrl = null;
            });
          }
          
          if (audioUrl) {
            audio.addEventListener('ended', () => {
              URL.revokeObjectURL(audioUrl!);
              setIsRecording(false);
            });
            break;
          }
        } catch (typeError) {
          console.log('Type not supported:', type);
          continue;
        }
      }
      
      if (!audioUrl) {
        console.error('No supported audio format found');
      }
      
    } catch (error) {
      console.error('Error playing audio response:', error);
    }
  }, []);

  const setupAudioStreaming = useCallback(() => {
    if (!mediaStreamRef.current || !wsRef.current) {
      console.log('Cannot setup audio streaming - missing stream or websocket');
      return;
    }

    console.log('Setting up audio streaming...');
    
    try {
      const mediaRecorder = new MediaRecorder(mediaStreamRef.current, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN && !callState.isMuted) {
          console.log('Sending audio data, size:', event.data.size);
          sendAudioData(event.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        console.log('MediaRecorder stopped');
      };
      
      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
      };
      
      // Start recording in chunks
      mediaRecorder.start(250); // Send data every 250ms
      
      // Store reference for cleanup
      mediaRecorderRef.current = mediaRecorder;
      
      console.log('Audio streaming setup completed');
      
    } catch (error) {
      console.error('Error setting up audio streaming:', error);
      toast({
        title: "Erro de Audio",
        description: "Falha ao configurar streaming de audio",
        variant: "destructive"
      });
    }
  }, [callState.isMuted, toast]);

  const sendAudioData = useCallback(async (audioBlob: Blob) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.log('WebSocket not ready for sending audio');
      return;
    }
    
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      
      const audioMessage = {
        realtimeInput: {
          mediaChunks: [{
            mimeType: 'audio/webm;codecs=opus',
            data: base64Data
          }]
        }
      };
      
      wsRef.current.send(JSON.stringify(audioMessage));
      console.log('Audio data sent successfully');
      
    } catch (error) {
      console.error('Error sending audio data:', error);
    }
  }, []);

  const startCall = useCallback(async () => {
    try {
      // Check microphone permission first
      const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      
      if (permission.state === 'denied') {
        toast({
          title: "Permissão Negada",
          description: "É necessário permitir acesso ao microfone. Verifique as configurações do navegador.",
          variant: "destructive"
        });
        return;
      }

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

      // Get user media with permission request
      try {
        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 16000
          }
        });
        
        console.log('Microphone access granted');
        
        // Connect to Live API after getting media
        await connectToLiveAPI();
        
      } catch (mediaError) {
        console.error('Microphone access error:', mediaError);
        
        if (mediaError.name === 'NotAllowedError') {
          toast({
            title: "Acesso Negado",
            description: "É necessário permitir o acesso ao microfone para fazer chamadas de voz.",
            variant: "destructive"
          });
        } else {
          toast({
            title: "Erro de Microfone",
            description: "Não foi possível acessar o microfone. Verifique se não está sendo usado por outro aplicativo.",
            variant: "destructive"
          });
        }
        
        endCall();
        return;
      }

    } catch (error) {
      console.error('Error starting call:', error);
      toast({
        title: "Erro",
        description: "Falha ao iniciar a chamada",
        variant: "destructive"
      });
      endCall();
    }
  }, [connectToLiveAPI, toast, endCall]);


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
          <VisuallyHidden>
            <DialogTitle>Chamada de Voz com IA</DialogTitle>
            <DialogDescription>Interface de chamada em tempo real com assistente de IA</DialogDescription>
          </VisuallyHidden>
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