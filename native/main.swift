// Reader Capture entry point for the pinned audio-mcp Swift package.
// The upstream controller also references these types in its unused input paths.
import Foundation
import Darwin

enum ExitCode: Int32 {
    case ok = 0, usage = 1, micPermissionDenied = 2, screenPermissionDenied = 3, runtimeError = 4
}
enum CaptureMode: String { case mic, system, both }
struct Args {
    let mode: CaptureMode = .system
    let sampleRate = 16000
    let micDeviceId: String? = nil
    let excludePid: Int32? = nil
}

let args = Array(CommandLine.arguments.dropFirst())
guard args.count == 5, args.prefix(3).elementsEqual(["capture", "--mode=system", "--sample-rate=16000"]),
      args[3].hasPrefix("--seconds="), let seconds = UInt32(args[3].dropFirst("--seconds=".count)),
      (1...30).contains(seconds),
      args[4].hasPrefix("--owner-pid="), let owner = pid_t(args[4].dropFirst("--owner-pid=".count)),
      owner > 1, getppid() == owner else {
    FileHandle.standardError.write(Data("Expected bounded system capture from its owning process.\n".utf8))
    exit(ExitCode.usage.rawValue)
}

// Arm before any audio/permission code. The wrapper normally sends TERM at the
// requested deadline. These bounds still work if that wrapper is lost or stuck.
signal(SIGALRM, SIG_DFL)
alarm(seconds + 1)
let deadline = DispatchTime.now() + .seconds(Int(seconds))
let lifetime = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "reader-capture.lifetime"))
lifetime.schedule(deadline: .now(), repeating: .milliseconds(50))
lifetime.setEventHandler {
    if getppid() != owner { _exit(ExitCode.runtimeError.rawValue) }
    if DispatchTime.now() >= deadline {
        lifetime.cancel()
        kill(getpid(), SIGTERM)
    }
}
lifetime.resume()
CaptureController.run(args: Args())
