export interface LandingSectionContent {
  kicker: string;
  title: string;
  description: string;
  heading: "h1" | "h2";
}

export const LANDING_SECTIONS: LandingSectionContent[] = [
  {
    kicker: "Read Faster, Stay Focused",
    title: "Speed Reader keeps your eyes in one place while the text moves for you.",
    description:
      "RSVP pacing, contextual preview, and keyboard-first controls are built to help you move through long material without losing comprehension.",
    heading: "h1",
  },
  {
    kicker: "Built for Real Reading Sessions",
    title: "Upload books, tune pacing, and move between chapters without breaking rhythm.",
    description:
      "The reader supports PDF and EPUB workflows with adjustable pauses, WPM controls, and context visibility that adapts to your pace.",
    heading: "h2",
  },
  {
    kicker: "Account Benefits",
    title: "Use guest mode now, then sign in when you want full AI and account features.",
    description:
      "Guest mode is instant. Login unlocks BYOK provider setup, usage history, and managed billing as those features roll out.",
    heading: "h2",
  },
];
