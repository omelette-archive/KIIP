import Dashboard from "./Dashboard";
import snapshot from "../public/data/dashboard-snapshot.json";

export default function Home() {
  return <Dashboard snapshot={snapshot} />;
}
