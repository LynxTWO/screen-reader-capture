// Link the real native entry point to a silent stand-in for ScreenCaptureKit.
// One synthetic frame marks readiness, then no more frames (or pipe writes).
import Foundation
import Darwin

enum CaptureController {
    static func run(args: Args) {
        if ProcessInfo.processInfo.environment["TEST_COOPERATIVE"] == nil {
            signal(SIGTERM, SIG_IGN)
        }
        FileHandle.standardOutput.write(Data([0, 0]))
        while true { pause() }
    }
}
