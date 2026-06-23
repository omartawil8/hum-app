import UIKit
import WebKit
import Capacitor

// Custom bridge view controller. Two jobs:
//
//   1. `alwaysBounceVertical` → the page gets the native iOS rubber-band overscroll even
//      when its content is shorter than the screen (like Spotify / Apple apps).
//
//   2. Seamless overscroll. WKWebView will not reliably render a custom gradient into its
//      rubber-band region (it composites its own content over anything placed behind it),
//      so instead of trying to match a *gradient* we make the canvas a single flat color:
//      the web page background is flat #0D0B10 on native (App.jsx / index.css `.native`
//      class) and the scroll view's background is the same #0D0B10. The content area and
//      the overscroll region are then the identical solid color — seamless by construction,
//      with no dependency on WKWebView internals.
//
// Applied on every appearance because Capacitor configures the web view during its own
// setup; applying once can get reverted.
class ViewController: CAPBridgeViewController {

    private let baseColor = UIColor(red: 13.0/255.0, green: 11.0/255.0, blue: 16.0/255.0, alpha: 1.0)

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        applyConfig()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        applyConfig()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        applyConfig()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        applyConfig()
    }

    private func applyConfig() {
        guard let webView = self.webView else { return }
        webView.isOpaque = true
        webView.backgroundColor = baseColor
        let scrollView = webView.scrollView
        scrollView.backgroundColor = baseColor // fills the rubber-band region
        scrollView.bounces = true
        scrollView.alwaysBounceVertical = true
        scrollView.alwaysBounceHorizontal = false
    }
}
