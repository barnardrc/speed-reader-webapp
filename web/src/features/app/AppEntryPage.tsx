import { useEffect, useState, type FC } from "react";

import type { UserProfile } from "../../lib/types";
import { AccountPanel } from "./AccountPanel";
import { OnboardingOverlay } from "../onboarding/OnboardingOverlay";
import { ReaderShell } from "../reader/ReaderShell";

interface AppEntryPageProps {
  guestMode: boolean;
  showOnboarding: boolean;
  onCloseOnboarding: () => void;
  onLogIn: () => void;
  onSignUp: () => void;
  user: UserProfile | null;
  onOpenAccountPage: () => void;
  onLogout: () => void;
}

export const AppEntryPage: FC<AppEntryPageProps> = ({
  guestMode,
  showOnboarding,
  onCloseOnboarding,
  onLogIn,
  onSignUp,
  user,
  onOpenAccountPage,
  onLogout,
}) => {
  const [guestBannerDismissed, setGuestBannerDismissed] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [readerSettingsOpen, setReaderSettingsOpen] = useState(false);

  useEffect(() => {
    if (!guestMode) {
      setGuestBannerDismissed(false);
    }
  }, [guestMode]);

  function dismissGuestBanner(): void {
    setGuestBannerDismissed(true);
  }

  return (
    <div className="app-router-root">
      {guestMode && !guestBannerDismissed ? (
        <div className="guest-mode-banner" role="status" aria-live="polite">
          <p>
            Guest mode: reading is enabled, but saved progress, provider keys, and billing features require an account.
          </p>
          <div className="guest-mode-actions">
            <button type="button" onClick={onLogIn}>
              Log In
            </button>
            <button type="button" className="btn-secondary" onClick={onSignUp}>
              Sign Up
            </button>
            <button type="button" className="banner-dismiss-btn" onClick={dismissGuestBanner} aria-label="Dismiss guest mode banner">
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {accountOpen && user ? (
        <AccountPanel
          user={user}
          onClose={() => setAccountOpen(false)}
          onOpenAccountPage={onOpenAccountPage}
          onLogout={onLogout}
        />
      ) : null}

      <ReaderShell
        settingsOpen={readerSettingsOpen}
        onSettingsOpenChange={setReaderSettingsOpen}
        user={user}
        onLogIn={onLogIn}
        onSignUp={onSignUp}
        onOpenAccount={() => setAccountOpen(true)}
      />
      <OnboardingOverlay open={showOnboarding} onClose={onCloseOnboarding} />
    </div>
  );
};
