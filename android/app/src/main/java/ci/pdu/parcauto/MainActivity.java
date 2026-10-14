package ci.pdu.parcauto;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Zoom a deux doigts : le WebView d'Android l'interdit par defaut.
        // Les boutons + / - natifs restent caches ; l'application a les siens
        // (REGLAGES -> Apparence -> Taille de l'affichage).
        WebSettings reglages = getBridge().getWebView().getSettings();
        reglages.setSupportZoom(true);
        reglages.setBuiltInZoomControls(true);
        reglages.setDisplayZoomControls(false);
    }
}
