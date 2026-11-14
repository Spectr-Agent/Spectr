# Spectr asset folder

Palette: black, white and light blue only. Props on every pose use light blue and black.

## mascot/
White clay star with a blue tint, same camera angle, lighting and clay color on every pose.
Transparent PNGs at 1x, 2x and 3x (name.png, name@2x.png, name@3x.png). Named by task state.

must_have/
  spectr_welcome, spectr_working, spectr_success, spectr_error, spectr_listening,
  spectr_link_expired, spectr_unpaired_phone, spectr_mic_denied, spectr_screen_capture_denied
nice_to_have/
  spectr_waiting_for_answer, spectr_stopped, spectr_launch_star,
  spectr_permission_mic, spectr_permission_screen_capture, spectr_permission_automation,
  spectr_mac_helper_pairing_hero, spectr_devpost_cover_art, spectr_pitch_hero
app_icon/       spectr_icon_star (transparent) and spectr_app_icon_light_1024 / dark_1024 (opaque)
composites/     launch screen 1290x2796, Devpost cover 2400x1600, pitch slide hero 1920x1080 (light and dark)
imessage_sticker/  white die cut outline at 618, 408 and 300 px
previous/       earlier star renders, .blend files, rigged .blend and .glb (Idle and Bounce animations)

Skipped on purpose (keep these flat, no clay): Mac menu bar icon, live viewer, transcript,
buttons and status text, tab bar and small control icons.

## logo/
clay_black_3d/  black clay wordmark, star and full lockup (straight, plus one tilted hero)
flat/           black and white transparent, black on white, white on black, wordmark only, icon only
favicon/        rounded avatar 1024, favicon sizes 512 to 16, favicon.ico
The flat files come from the PNG you sent. Ask for an SVG trace if you need vector.

## qa/        contact sheets on light (#F5F8FC) and dark (#0F1623) backgrounds
## source/    Blender scripts that built everything (make_assets_mono.py is the current one)
