import { useMemo, useState, type FC } from "react";

function isVideoAsset(url: string): boolean {
  return /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
}

export const FloatingDemo: FC = () => {
  const [mediaError, setMediaError] = useState(false);
  const configuredUrl = (import.meta.env.VITE_LANDING_DEMO_URL as string | undefined)?.trim();
  const mediaUrl = useMemo(() => configuredUrl || "/landing-demo.gif", [configuredUrl]);

  function onMediaError(): void {
    setMediaError(true);
  }

  return (
    <aside className="landing-demo-wrap" aria-hidden="true">
      <div className="landing-demo-card">
        <div className="landing-demo-head">
          <span />
          <span />
          <span />
          <strong>Live Reader Demo</strong>
        </div>

        {!mediaError && mediaUrl ? (
          isVideoAsset(mediaUrl) ? (
            <video className="landing-demo-media" autoPlay loop muted playsInline onError={onMediaError}>
              <source src={mediaUrl} />
            </video>
          ) : (
            <img className="landing-demo-media" src={mediaUrl} alt="Speed Reader demo" onError={onMediaError} />
          )
        ) : (
          <div className="landing-demo-fallback">
            <div className="landing-demo-row strong" />
            <div className="landing-demo-row" />
            <div className="landing-demo-row short" />
            <div className="landing-demo-rsvp">
              <span className="left">context</span>
              <span className="focus">FOCUS</span>
              <span className="right">next</span>
            </div>
            <div className="landing-demo-row" />
          </div>
        )}
      </div>
    </aside>
  );
};
