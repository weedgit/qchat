import LoadingSplash from "@/components/LoadingSplash";

/** Route-level wait UI — avoids a blank dark frame while chat/login chunks load. */
export default function Loading() {
  return <LoadingSplash />;
}
