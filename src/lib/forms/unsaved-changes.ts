"use client";

import { useEffect, useRef } from "react";

const navigationEvent = "qafilah:leave-product-form";

/** A mounted product form may veto Store switching; this never initiates navigation or saving. */
export function confirmUnsavedNavigation(): boolean {
  return window.dispatchEvent(new Event(navigationEvent, { cancelable: true }));
}

export function useUnsavedProductChanges(dirty: boolean, pending: boolean) {
  const completed = useRef(false);
  useEffect(() => {
    if (!dirty && !pending) return;
    const confirm = () =>
      completed.current ||
      window.confirm(
        pending
          ? "A product change is being sent. Leaving does not cancel a change already received by the server. Leave this page?"
          : "You have unsaved product changes. Leave without saving?",
      );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (completed.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const leave = (event: Event) => {
      if (!confirm()) event.preventDefault();
    };
    const linkClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === "_blank" ||
        link.hasAttribute("download")
      )
        return;
      const destination = new URL(link.href);
      // Same-page anchors do not discard input. External navigation is handled
      // once by beforeunload rather than prompting twice for the same departure.
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === window.location.pathname &&
          destination.search === window.location.search)
      )
        return;
      if (!confirm()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener(navigationEvent, leave);
    document.addEventListener("click", linkClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener(navigationEvent, leave);
      document.removeEventListener("click", linkClick, true);
    };
  }, [dirty, pending]);
  return () => {
    completed.current = true;
  };
}
