# Native (Swift) commands for Spectr. TypeScript commands live in services/api.
SHELL := /bin/bash
PROJECT := apps/Spectr.xcodeproj
DERIVED := apps/build/DerivedData
PACKAGES := apps/build/SourcePackages
SWIFT_SOURCES := apps/ios apps/mac packages/SpectrKit/Sources packages/SpectrKit/Tests packages/SpectrKit/Package.swift
XCB := xcodebuild -project $(PROJECT) -derivedDataPath $(DERIVED) -clonedSourcePackagesDirPath $(PACKAGES) CODE_SIGNING_ALLOWED=NO
# Simulator builds are signed ad hoc ("-"), which needs no identity or team. An unsigned
# app has no entitlements, so every Keychain call fails and sign-in cannot be saved.
# They build outside the repo because code signing rejects files in cloud-synced folders
# (for example a checkout under an iCloud-synced ~/Documents).
SIM_DERIVED ?= $(HOME)/Library/Developer/Xcode/DerivedData/Spectr-sim
XCB_SIM := xcodebuild -project $(PROJECT) -derivedDataPath $(SIM_DERIVED) -clonedSourcePackagesDirPath $(PACKAGES) CODE_SIGN_IDENTITY=-
# First available iPhone simulator; override with IOS_SIM=<udid>.
IOS_SIM ?= $(shell xcrun simctl list devices available -j | python3 -c "import json,sys;d=json.load(sys.stdin)['devices'];print(next((x['udid'] for k,v in d.items() if 'iOS' in k for x in v if x['name'].startswith('iPhone')),''))")

.PHONY: bootstrap resolve format lint test-kit test-ios test-mac run-mac build-release check-release test ci clean

# Generate the Xcode project and restore the pinned package versions.
bootstrap:
	xcodegen generate --spec apps/project.yml --quiet
	mkdir -p $(PROJECT)/project.xcworkspace/xcshareddata/swiftpm
	cp apps/Package.resolved $(PROJECT)/project.xcworkspace/xcshareddata/swiftpm/Package.resolved

resolve: bootstrap
	$(XCB) -resolvePackageDependencies -scheme SpectrMac -onlyUsePackageVersionsFromResolvedFile

format:
	xcrun swift-format format --in-place --recursive --parallel $(SWIFT_SOURCES)

lint:
	xcrun swift-format lint --strict --recursive --parallel $(SWIFT_SOURCES)

test-kit:
	cd packages/SpectrKit && swift test

test-ios: resolve
	@test -n "$(IOS_SIM)" || { echo "No iPhone simulator available"; exit 1; }
	$(XCB_SIM) test -scheme SpectrIOS -destination "id=$(IOS_SIM)"

test-mac: resolve
	$(XCB) test -scheme SpectrMac -destination "platform=macOS"

# Build, sign and launch the Debug Mac helper from ~/Applications.
# Two things macOS requires before it will prompt for, list or remember Screen Recording
# and Accessibility for an app:
#  1. A real signature. Uses the first code-signing identity in the keychain; override
#     with MAC_SIGN_IDENTITY ("-" is ad hoc: listed, but re-granted on every build).
#  2. A bundle with no stray file attributes. This repo sits in an iCloud-synced folder,
#     which keeps stamping Finder attributes onto the build output and silently
#     invalidates the signature, so the app is copied out, without attributes, first.
MAC_SIGN_IDENTITY ?= $(shell security find-identity -v -p codesigning | awk 'NR==1 && $$2 ~ /^[0-9A-F]+$$/ {print $$2}')
MAC_DEBUG_APP := $(DERIVED)/Build/Products/Debug/SpectrMac.app
MAC_RUN_APP := $(HOME)/Applications/SpectrMac.app

run-mac: resolve
	$(XCB) build -scheme SpectrMac -configuration Debug -destination "platform=macOS" -quiet
	-pkill -f "SpectrMac.app/Contents/MacOS/SpectrMac"
	mkdir -p "$(dir $(MAC_RUN_APP))"
	rm -rf "$(MAC_RUN_APP)"
	ditto --noextattr --norsrc "$(MAC_DEBUG_APP)" "$(MAC_RUN_APP)"
	codesign --force --deep --sign "$(or $(MAC_SIGN_IDENTITY),-)" "$(MAC_RUN_APP)"
	codesign --verify --deep --strict "$(MAC_RUN_APP)"
	open "$(MAC_RUN_APP)"

build-release: resolve
	$(XCB) build -scheme SpectrIOS -configuration Release -destination "generic/platform=iOS Simulator"
	$(XCB) build -scheme SpectrMac -configuration Release -destination "platform=macOS"

# Release bundles must declare production and must not contain fixture JSON.
check-release: build-release
	@for app in "$(DERIVED)/Build/Products/Release-iphonesimulator/SpectrIOS.app" "$(DERIVED)/Build/Products/Release/SpectrMac.app"; do \
	  plist="$$app/Info.plist"; [ -f "$$plist" ] || plist="$$app/Contents/Info.plist"; \
	  env=$$(/usr/libexec/PlistBuddy -c "Print :SpectrEnvironment" "$$plist"); \
	  [ "$$env" = "production" ] || { echo "FAIL $$app environment=$$env"; exit 1; }; \
	  if find "$$app" -name '*.json' -not -path '*/Frameworks/*' | grep -q .; then echo "FAIL fixture JSON in $$app"; exit 1; fi; \
	  echo "OK $$app"; \
	done

test: lint test-kit test-ios test-mac check-release

ci: test

clean:
	rm -rf apps/build packages/SpectrKit/.build
