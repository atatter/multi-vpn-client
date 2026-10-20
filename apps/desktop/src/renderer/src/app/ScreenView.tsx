import { AddScreen } from "../add-vpn/AddScreen.tsx";
import { SignInScreen } from "../add-vpn/SignInScreen.tsx";
import { CheckScreen } from "../check/CheckScreen.tsx";
import { SettingsScreen } from "../settings/SettingsScreen.tsx";
import type { Screen } from "../store/screen.ts";
import { TrafficScreen } from "../traffic/TrafficScreen.tsx";
import { HomeScreen } from "../vpn-list/HomeScreen.tsx";
import { VpnScreen } from "../vpn-page/VpnScreen.tsx";

export function ScreenView({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case "list":
      return <HomeScreen />;
    case "add":
      return <AddScreen />;
    case "signin":
      return <SignInScreen screen={screen} />;
    case "vpn":
      return <VpnScreen vpnId={screen.vpnId} />;
    case "traffic":
      return <TrafficScreen />;
    case "check":
      return <CheckScreen query={screen.query} />;
    case "settings":
      return <SettingsScreen />;
  }
}
