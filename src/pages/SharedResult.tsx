import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Paintbrush, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import BeforeAfterSlider from "@/components/BeforeAfterSlider";
import { getResultByShareId, type SavedResult } from "@/lib/api";

const SharedResult = () => {
  const { shareId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<SavedResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!shareId) return;
    getResultByShareId(shareId)
      .then((result) => {
        if (result) setData(result);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [shareId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground text-lg">This shared result was not found.</p>
        <Button onClick={() => navigate("/")}>Go to RoomTint</Button>
      </div>
    );
  }

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
          <div>
            <h1 className="font-display text-xl font-semibold text-foreground">RoomTint</h1>
            <p className="text-xs text-muted-foreground">Shared room transformation</p>
          </div>
        </div>
      </header>
      <main className="container max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg" style={{ backgroundColor: data.color_hex }} />
          <div>
            <p className="text-sm font-medium text-foreground">
              Wall Color: <span className="font-mono uppercase">{data.color_hex}</span>
            </p>
            <p className="text-xs text-muted-foreground">Intensity: {data.intensity}%</p>
          </div>
        </div>
        {data.original_image_url && data.result_image_url ? (
          <BeforeAfterSlider beforeImage={data.original_image_url} afterImage={data.result_image_url} />
        ) : (
          <div className="w-full aspect-[4/3] rounded-xl flex items-center justify-center"
            style={{ backgroundColor: data.color_hex + "22" }}>
            <div className="w-24 h-24 rounded-full" style={{ backgroundColor: data.color_hex }} />
          </div>
        )}
        <div className="text-center">
          <Button onClick={() => navigate("/")}>Try RoomTint yourself</Button>
        </div>
      </main>
    </div>
  );
};

export default SharedResult;
