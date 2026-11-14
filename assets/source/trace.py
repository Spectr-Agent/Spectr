import sys, json, cv2, numpy as np
src, out = sys.argv[1], sys.argv[2]
im = cv2.imread(src, cv2.IMREAD_GRAYSCALE)
H, W = im.shape
print("size", W, H)
_, bw = cv2.threshold(im, 128, 255, cv2.THRESH_BINARY_INV)
bw = cv2.GaussianBlur(bw, (0,0), 1.2)
_, bw = cv2.threshold(bw, 128, 255, cv2.THRESH_BINARY)
cs, hier = cv2.findContours(bw, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
res = []
for i, c in enumerate(cs):
    if cv2.contourArea(c) < 80: continue
    eps = 0.8
    a = cv2.approxPolyDP(c, eps, True)[:,0,:].astype(float)
    res.append(dict(pts=a.tolist(), hole=bool(hier[0][i][3] != -1), area=cv2.contourArea(c),
                    bb=list(cv2.boundingRect(c))))
json.dump(dict(W=W, H=H, c=res), open(out, "w"))
print(len(res), [ (r['hole'], r['bb']) for r in res])
