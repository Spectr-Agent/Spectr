"use client";

import { useEffect, useState } from "react";

/** How many research facts fit on one carousel page: three on wide screens, one on narrow ones. */
export function useFactsPerPage(): number {
  const [size, setSize] = useState(3);
  useEffect(() => {
    const query = window.matchMedia("(max-width:1100px)");
    const update = () => setSize(query.matches ? 1 : 3);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return size;
}
