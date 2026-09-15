import type { FC } from "react";

import { FloatingDemo } from "./FloatingDemo";
import { LandingSection } from "./LandingSection";
import { LANDING_SECTIONS } from "./landingContent";
import { TopBanner } from "./TopBanner";

interface LandingPageProps {
  onContinueToApp: () => void;
  onLogIn: () => void;
  onSignUp: () => void;
}

export const LandingPage: FC<LandingPageProps> = ({ onContinueToApp, onLogIn, onSignUp }) => {
  return (
    <div className="landing-page">
      <TopBanner onContinueToApp={onContinueToApp} onLogIn={onLogIn} />

      <FloatingDemo />

      <main className="landing-scroll">
        <LandingSection content={LANDING_SECTIONS[0]} />
        <LandingSection content={LANDING_SECTIONS[1]} />
        <LandingSection
          content={LANDING_SECTIONS[2]}
          cta={
            <div className="landing-cta-actions">
              <button type="button" onClick={onSignUp}>
                Sign Up
              </button>
              <button type="button" className="btn-secondary" onClick={onLogIn}>
                Log In
              </button>
              <button type="button" className="btn-ghost" onClick={onContinueToApp}>
                Continue to App
              </button>
            </div>
          }
        />
      </main>
    </div>
  );
};
