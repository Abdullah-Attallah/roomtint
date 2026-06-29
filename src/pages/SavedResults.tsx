import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Paintbrush, Trash2, ArrowLeft, Share2, Check, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getSavedResults, deleteResult, getLocalImagesForResult, type SavedResult } from "@/lib/api";

const SavedResults = () => {
  const navigate = useNavigate();
  const [results, setResults] = useState<SavedResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    getSavedResults()
      .then((data) => {
        // Merge DB rows with locally cached images
        const enriched = data.map((r) => ({
          ...r,
          ...getLocalImagesForResult(r.id),
        }));
        setResults(enriched);
      })
      .catch((err) => {
        toast({
          title: "Could not load saved results",
          description: err.message,
          variant: "destructive",
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await deleteResult(id);
      setResults((r) => r.filter((x) => x.id !== id));
      toast({ title: "Deleted", description: "Result removed from your collection" });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  };

  const handleShare = async (result: SavedResult) => {
    const shareUrl = `${window.location.origin}/shared/${result.share_id}`;
    await navigator.clipboard.writeText(shareUrl);
    setCopiedId(result.id);
    toast({ title: "Link copied!", description: "Share this link with anyone." });
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <Paintbrush className="w-5 h-5 text-primary-foreground" />
          </div>
          <h1 className="font-display text-xl font-semibold text-foreground">Saved Results</h1>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-muted-foreground">No saved results yet. Start recoloring rooms!</p>
            <Button className="mt-4" onClick={() => navigate("/")}>
              Go to Editor
            </Button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {results.map((r) => (
              <div key={r.id} className="bg-card rounded-xl border border-border overflow-hidden">
                {r.result_image_url ? (
                  <img
                    src={r.result_image_url}
                    alt="Recolored room"
                    className="w-full aspect-[4/3] object-cover"
                  />
                ) : (
                  <div
                    className="w-full aspect-[4/3] flex items-center justify-center"
                    style={{ backgroundColor: r.color_hex + "33" }}
                  >
                    <div className="w-16 h-16 rounded-full" style={{ backgroundColor: r.color_hex }} />
                  </div>
                )}
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded" style={{ backgroundColor: r.color_hex }} />
                    <span className="text-xs font-mono text-muted-foreground uppercase">{r.color_hex}</span>
                    <span className="text-xs text-muted-foreground">· {r.intensity}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {r.share_id && (
                      <Button variant="ghost" size="icon" onClick={() => handleShare(r)}>
                        {copiedId === r.id ? (
                          <Check className="w-4 h-4 text-green-500" />
                        ) : (
                          <Share2 className="w-4 h-4" />
                        )}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default SavedResults;
