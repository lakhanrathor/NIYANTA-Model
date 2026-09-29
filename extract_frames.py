import cv2
import os

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))
video_path = os.path.join(NIYANTA_ROOT, 'reference.mp4')
output_dir = os.path.join(NIYANTA_ROOT, 'docs', 'images')

if not os.path.exists(output_dir):
    os.makedirs(output_dir)

cap = cv2.VideoCapture(video_path)

if not cap.isOpened():
    print(f"Error: Could not open video {video_path}")
    exit()

fps = cap.get(cv2.CAP_PROP_FPS)
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

# The video is about 8 seconds long based on my previous viewing.
# The user wants frames from the second half (tactical dashboard UI).
# Let's extract frames at 4.0s, 6.0s, and 8.0s.

target_times = [4.0, 6.0, 7.5]

for t in target_times:
    frame_no = int(t * fps)
    if frame_no < total_frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
        ret, frame = cap.read()
        if ret:
            output_file = os.path.join(output_dir, f'dashboard_ui_{t}s.png')
            cv2.imwrite(output_file, frame)
            print(f"Saved {output_file}")
        else:
            print(f"Error reading frame {frame_no}")

cap.release()
print("Done extracting frames.")
