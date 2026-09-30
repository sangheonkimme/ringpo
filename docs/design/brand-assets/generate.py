import json, os, subprocess, time
from PIL import Image
S=os.path.dirname(os.path.abspath(__file__))
H=os.path.join(S,'html'); OUT=os.path.join(S,'out'); os.makedirs(OUT,exist_ok=True)
paths=json.load(open(os.path.join(S,'..','ds-v2','logo-paths.json')))
INK='#142338'; LIME='#CCF76B'; WHITE='#FFFFFF'
sym=''.join(f'<path d="{d}"/>' for d in paths['symbol'])
wm=''.join(f'<path d="{d}"/>' for d in paths['wordmark'])
def symbol_svg(color, size, x=0, y=0):
    return f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="0 0 120 120" fill="none" stroke="{color}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">{sym}</svg>'
FONT="@font-face{font-family:P;src:url(PretendardVariable.ttf);font-weight:100 900}"
def page(body,w,h,bg='transparent'):
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{FONT}html,body{{margin:0;width:{w}px;height:{h}px;overflow:hidden;background:{bg}}}*{{box-sizing:border-box}}</style></head><body>{body}</body></html>'
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
def render(name, html, w, h, transparent=False):
    f=os.path.join(H,name+'.html'); open(f,'w').write(html)
    out=os.path.join(OUT,name+'.png')
    if os.path.exists(out): os.remove(out)
    args=[CH,'--headless=new','--disable-gpu','--hide-scrollbars',f'--window-size={w},{h}','--force-device-scale-factor=1','--screenshot='+out,'--virtual-time-budget=3000']
    if transparent: args.append('--default-background-color=00000000')
    p=subprocess.Popen(args+['file://'+f],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    last=-1
    for _ in range(120):
        time.sleep(0.25)
        if os.path.exists(out):
            s=os.path.getsize(out)
            if s==last and s>0: break
            last=s
    p.kill(); time.sleep(0.3)
    im=Image.open(out); im=im.crop((0,0,w,h)); im.save(out); return out

# 1) 앱 아이콘(정사각, 모서리는 플랫폼이 둥글게 깎음): 96 격자에서 심볼 68 → 70.8%
def app_icon(n, bg=INK, fg=LIME):
    s=round(n*68/96); o=round(n*14/96)
    body=f'<svg width="{n}" height="{n}" viewBox="0 0 {n} {n}"><rect width="{n}" height="{n}" fill="{bg}"/>{symbol_svg(fg,s,o,o)}</svg>'
    return page(body,n,n)
render('meta-app-icon-1024', app_icon(1024), 1024,1024)
render('app-icon-lime-1024', app_icon(1024, LIME, INK), 1024,1024)

# 2) 프로필(원형으로 잘려도 안전하게 심볼 56%)
def profile(n):
    s=round(n*0.56); o=round((n-s)/2); oy=round(o+n*0.02)
    body=f'<svg width="{n}" height="{n}" viewBox="0 0 {n} {n}"><rect width="{n}" height="{n}" fill="{INK}"/>{symbol_svg(LIME,s,o,oy)}</svg>'
    return page(body,n,n)
render('profile-1080', profile(1080), 1080,1080)

# 3) 로고(투명 배경): 심볼 64 + 간격 12 + 워드마크 182x70 (높이 70 기준)
def logo(color, scale):
    w=round((64+12+182)*scale); h=round(70*scale)
    body=f'<svg width="{w}" height="{h}" viewBox="0 0 258 70">{symbol_svg(color,64,0,3)}<g transform="translate(76 0)" fill="{color}">{wm}</g></svg>'
    return page(body,w,h), w, h
for nm,c in [('logo-ink',INK),('logo-white',WHITE),('logo-lime',LIME)]:
    html,w,h=logo(c,4); render(nm+'-1032w', html, w,h, transparent=True)

# 4) 공유 미리보기(OG) 1200x630
og=f'''<div style="width:1200px;height:630px;background:{INK};padding:84px 96px;display:flex;flex-direction:column;justify-content:space-between;font-family:P;color:#fff">
<svg width="344" height="93" viewBox="0 0 258 70">{symbol_svg(LIME,64,0,3)}<g transform="translate(76 0)" fill="#fff">{wm}</g></svg>
<div><div style="font-size:84px;font-weight:800;line-height:1.14;letter-spacing:-0.04em">댓글에 <span style="background:linear-gradient(transparent 60%,{LIME}55 60%)">‘링크’</span><br>남겨주세요.</div>
<div style="margin-top:22px;font-size:40px;font-weight:700;color:#D3DBE5;letter-spacing:-0.02em">DM은 링포가 보낼게요. <span style="color:{LIME}">인스타 댓글 자동 DM</span></div></div></div>'''
render('og-image-1200x630', page(og,1200,630), 1200,630)

# 5) 크기별 파생 이미지
src=Image.open(os.path.join(OUT,'meta-app-icon-1024.png')).convert('RGB')
for n in [512,256,192,180,128]:
    src.resize((n,n),Image.LANCZOS).save(os.path.join(OUT,f'app-icon-{n}.png'),optimize=True)
os.rename(os.path.join(OUT,'app-icon-128.png'),os.path.join(OUT,'kakao-app-icon-128.png'))
os.rename(os.path.join(OUT,'app-icon-180.png'),os.path.join(OUT,'apple-touch-icon-180.png'))
Image.open(os.path.join(OUT,'profile-1080.png')).convert('RGB').resize((640,640),Image.LANCZOS).save(os.path.join(OUT,'profile-640.png'),optimize=True)
# 파비콘: 둥근 타일(투명 모서리) 16/32/48
from PIL import ImageDraw
big=src.resize((256,256),Image.LANCZOS).convert('RGBA'); mask=Image.new('L',(256,256),0)
ImageDraw.Draw(mask).rounded_rectangle((0,0,255,255),radius=64,fill=255); big.putalpha(mask)
big.save(os.path.join(OUT,'favicon.ico'),sizes=[(16,16),(32,32),(48,48)])
# 원본 1024도 용량 줄여 저장
for f in os.listdir(OUT):
    if f.endswith('.png'):
        p=os.path.join(OUT,f); im=Image.open(p); im.save(p,optimize=True)
for f in sorted(os.listdir(OUT)):
    p=os.path.join(OUT,f); im=Image.open(p) if f.endswith('.png') else None
    print(f, im.size if im else '', f'{os.path.getsize(p)//1024}KB')
