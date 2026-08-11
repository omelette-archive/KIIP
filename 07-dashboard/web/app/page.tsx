import Dashboard from "./Dashboard";
import snapshot from "../public/data/dashboard-snapshot.json";
import geometry from "../public/data/map-geometry.json";

export default function Home() {
  return <Dashboard snapshot={snapshot} geometry={geometry} />;
}
