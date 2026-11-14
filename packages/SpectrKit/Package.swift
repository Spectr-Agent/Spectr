// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "SpectrKit",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "SpectrKit", targets: ["SpectrKit"])
    ],
    targets: [
        .target(name: "SpectrKit"),
        .testTarget(
            name: "SpectrKitTests",
            dependencies: ["SpectrKit"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
