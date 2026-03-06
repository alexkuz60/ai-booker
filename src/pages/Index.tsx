import { useState } from "react";
import { motion } from "framer-motion";
import { BookOpen, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import VoiceSelector from "@/components/VoiceSelector";
import AudioPlayer from "@/components/AudioPlayer";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const MAX_CHARS = 5000;

const Index = () => {
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState("JBFqnCBsd6RMkjVDRZzb");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!text.trim()) {
      toast.error("Please enter some text to convert.");
      return;
    }
    if (text.length > MAX_CHARS) {
      toast.error(`Text must be under ${MAX_CHARS} characters.`);
      return;
    }

    setIsGenerating(true);
    setAudioUrl(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please sign in to use TTS");
        setIsGenerating(false);
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-tts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ text, voiceId }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error(err || "Failed to generate audio");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      toast.success("Audiobook generated!");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Failed to generate audio");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container max-w-4xl mx-auto px-6 py-5 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg gradient-amber flex items-center justify-center shadow-warm">
            <BookOpen className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold text-foreground tracking-tight">
              AI Booker
            </h1>
            <p className="text-xs text-muted-foreground font-body">
              Transform text into audiobooks
            </p>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container max-w-4xl mx-auto px-6 py-10 space-y-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center space-y-3"
        >
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground">
            Your words, <span className="text-primary">beautifully narrated</span>
          </h2>
          <p className="text-muted-foreground font-body max-w-lg mx-auto">
            Paste your text below, choose a narrator voice, and let AI create a
            professional audiobook in seconds.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="space-y-6"
        >
          {/* Text Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Your Text
            </label>
            <Textarea
              placeholder="Paste your book chapter, article, or any text here..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-[240px] bg-secondary border-border resize-y text-foreground font-body text-base leading-relaxed placeholder:text-muted-foreground"
            />
            <div className="flex justify-end">
              <span className={`text-xs font-body ${text.length > MAX_CHARS ? "text-destructive" : "text-muted-foreground"}`}>
                {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Voice Selection */}
          <VoiceSelector value={voiceId} onChange={setVoiceId} />

          {/* Generate Button */}
          <Button
            variant="hero"
            size="lg"
            onClick={handleGenerate}
            disabled={isGenerating || !text.trim()}
            className="w-full h-14 text-base"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Generating audiobook...
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5" />
                Generate Audiobook
              </>
            )}
          </Button>
        </motion.div>

        {/* Audio Player */}
        {audioUrl && (
          <AudioPlayer audioUrl={audioUrl} title="Generated Audiobook" />
        )}
      </main>
    </div>
  );
};

export default Index;
