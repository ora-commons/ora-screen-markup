// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OraScreenMarkup",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "OraScreenMarkup",
            path: "Sources/OraScreenMarkup",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
