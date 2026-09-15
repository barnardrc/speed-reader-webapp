import type { FC } from "react";

interface TopBannerProps {
  onContinueToApp: () => void;
  onLogIn: () => void;
}

export const TopBanner: FC<TopBannerProps> = ({ onContinueToApp, onLogIn }) => {
  return (
    <header className="landing-top-banner">
      <div className="landing-top-copy">
        <p className="landing-brand">Speed Reader</p>
        <p className="landing-topline">Explore the flow below, or jump into the app at any time.</p>
      </div>
      <div className="landing-top-actions">
        <button type="button" onClick={onContinueToApp}>
          Continue to App
        </button>
        <button type="button" className="btn-secondary" onClick={onLogIn}>
          Log In
        </button>
      </div>
    </header>
  );
};
