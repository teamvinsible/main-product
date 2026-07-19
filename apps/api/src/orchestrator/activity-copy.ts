/** Conversational activity lines — Nexus talking to the user like a teammate. */

export function activityFirstName(displayName?: string | null): string {
  const raw = (displayName || "").trim();
  if (!raw) return "there";
  const first = raw.split(/\s+/)[0] || "there";
  return first;
}

function say(name: string, body: string): string {
  return `${name}, ${body}`;
}

type PhaseCopy = {
  start: (name: string, title: string) => string;
  done: (name: string, title: string) => string;
};

const PHASE_COPY: Record<string, PhaseCopy> = {
  strategy: {
    start: (name, title) =>
      say(
        name,
        `I'm kicking off web research and scouting the best ideas for “${title}” — putting our BA analysts and researchers to work.`,
      ),
    done: (name) =>
      say(
        name,
        `Research is in. The product manager is standardizing the requirements now and will define the development rigor for the rest of the crew.`,
      ),
  },
  design: {
    start: (name) =>
      say(
        name,
        `Design is on it — our UX researcher and UI designer are mapping flows, friction points, and how this should feel on mobile and desktop.`,
      ),
    done: (name) =>
      say(
        name,
        `Design wrap-up is done. We've got a clearer picture of the experience — handing that to architecture next.`,
      ),
  },
  architecture: {
    start: (name) =>
      say(
        name,
        `Architecture is lining up the stack, data model, and system boundaries so engineering has a solid blueprint.`,
      ),
    done: (name) =>
      say(
        name,
        `Blueprint is locked. Backend engineering is next — they'll wire the APIs and data access against this plan.`,
      ),
  },
  "eng-backend": {
    start: (name) =>
      say(
        name,
        `Backend is building out the APIs, auth, and data layer the frontend will call into.`,
      ),
    done: (name) =>
      say(
        name,
        `Backend contracts are ready. Frontend is picking up the visible UI against those endpoints.`,
      ),
  },
  "eng-frontend": {
    start: (name) =>
      say(
        name,
        `Frontend is shaping the product UI now — making the experience real against the architecture we agreed on.`,
      ),
    done: (name) =>
      say(
        name,
        `UI build looks solid. QA is stepping in to stress-test edge cases and catch regressions before we ship.`,
      ),
  },
  qa: {
    start: (name) =>
      say(
        name,
        `QA is running scenarios, edge cases, and device checks so we don't surprise you at launch.`,
      ),
    done: (name) =>
      say(
        name,
        `Quality gate passed. DevOps is preparing release, staging→prod, and workspace readiness.`,
      ),
  },
  devops: {
    start: (name) =>
      say(
        name,
        `DevOps is tightening CI/CD, reliability notes, and making sure the workspace is actually shippable.`,
      ),
    done: (name) =>
      say(
        name,
        `Release path is ready. Marketing is drafting the launch checklist and go-live messaging next.`,
      ),
  },
  launch: {
    start: (name) =>
      say(
        name,
        `Launch marketing is on deck — messaging, channels, and the checklist for go-live.`,
      ),
    done: (name) =>
      say(
        name,
        `Launch plan is set. Growth is defining success metrics and post-launch experiments.`,
      ),
  },
  growth: {
    start: (name) =>
      say(
        name,
        `Growth is defining how we'll measure success and what to optimize after you go live.`,
      ),
    done: (name, title) =>
      say(
        name,
        `That's a wrap on the crew run for “${title}” — everything's ready for your review.`,
      ),
  },
};

export function activityBootstrapAccepted(name: string, title: string): string {
  return say(
    name,
    `I've got your brief for “${title}”. Assembling the crew now — I'll keep you in the loop as we move.`,
  );
}

export function activityBootstrapWorkflow(name: string): string {
  return say(
    name,
    `The run is live. Specialists will take each step in order — research, product, design, build, quality, then launch.`,
  );
}

export function activityRestarted(name: string, title: string): string {
  return say(
    name,
    `Stopping the current crew and restarting “${title}” from the top — fresh specialists, same brief.`,
  );
}

export function activityPhaseStart(phase: string, name: string, title: string): string {
  const copy = PHASE_COPY[phase];
  if (copy) return copy.start(name, title);
  return say(name, `We're starting the next phase — I'll update you when it's done.`);
}

export function activityPhaseDone(phase: string, name: string, title: string): string {
  const copy = PHASE_COPY[phase];
  if (copy) return copy.done(name, title);
  return say(name, `That phase is done — moving the crew forward.`);
}
