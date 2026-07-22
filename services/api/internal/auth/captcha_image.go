package auth

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
)

// 5×7 bitmap glyphs for captcha alphabet (A–Z minus I/O, digits 2–9).
var captchaGlyphs = map[byte][7]string{
	'A': {"01110", "10001", "10001", "11111", "10001", "10001", "10001"},
	'B': {"11110", "10001", "10001", "11110", "10001", "10001", "11110"},
	'C': {"01111", "10000", "10000", "10000", "10000", "10000", "01111"},
	'D': {"11110", "10001", "10001", "10001", "10001", "10001", "11110"},
	'E': {"11111", "10000", "10000", "11110", "10000", "10000", "11111"},
	'F': {"11111", "10000", "10000", "11110", "10000", "10000", "10000"},
	'G': {"01111", "10000", "10000", "10111", "10001", "10001", "01111"},
	'H': {"10001", "10001", "10001", "11111", "10001", "10001", "10001"},
	'J': {"00111", "00001", "00001", "00001", "00001", "10001", "01110"},
	'K': {"10001", "10010", "10100", "11000", "10100", "10010", "10001"},
	'L': {"10000", "10000", "10000", "10000", "10000", "10000", "11111"},
	'M': {"10001", "11011", "10101", "10001", "10001", "10001", "10001"},
	'N': {"10001", "11001", "10101", "10011", "10001", "10001", "10001"},
	'P': {"11110", "10001", "10001", "11110", "10000", "10000", "10000"},
	'Q': {"01110", "10001", "10001", "10001", "10101", "10010", "01101"},
	'R': {"11110", "10001", "10001", "11110", "10100", "10010", "10001"},
	'S': {"01111", "10000", "10000", "01110", "00001", "00001", "11110"},
	'T': {"11111", "00100", "00100", "00100", "00100", "00100", "00100"},
	'U': {"10001", "10001", "10001", "10001", "10001", "10001", "01110"},
	'V': {"10001", "10001", "10001", "10001", "10001", "01010", "00100"},
	'W': {"10001", "10001", "10001", "10001", "10101", "11011", "10001"},
	'X': {"10001", "10001", "01010", "00100", "01010", "10001", "10001"},
	'Y': {"10001", "10001", "01010", "00100", "00100", "00100", "00100"},
	'Z': {"11111", "00001", "00010", "00100", "01000", "10000", "11111"},
	'2': {"01110", "10001", "00001", "00010", "00100", "01000", "11111"},
	'3': {"01110", "10001", "00001", "00110", "00001", "10001", "01110"},
	'4': {"00010", "00110", "01010", "10010", "11111", "00010", "00010"},
	'5': {"11111", "10000", "11110", "00001", "00001", "10001", "01110"},
	'6': {"01110", "10000", "10000", "11110", "10001", "10001", "01110"},
	'7': {"11111", "00001", "00010", "00100", "01000", "01000", "01000"},
	'8': {"01110", "10001", "10001", "01110", "10001", "10001", "01110"},
	'9': {"01110", "10001", "10001", "01111", "00001", "00001", "01110"},
}

func randByte() byte {
	var b [1]byte
	_, _ = rand.Read(b[:])
	return b[0]
}

func randInt(n int) int {
	if n <= 0 {
		return 0
	}
	return int(randByte()) % n
}

func randFloat() float64 {
	return float64(randByte()) / 255.0
}

// RenderCaptchaPNG draws code into a noisy, wave-warped PNG and returns a data URL.
// Designed to stay human-readable while resisting naive OCR.
func RenderCaptchaPNG(code string) (dataURL string, err error) {
	const (
		scale  = 5
		padX   = 18
		padY   = 14
		glyphW = 5
		glyphH = 7
	)
	charStep := glyphW*scale + 6 + randInt(5)
	w := padX*2 + len(code)*charStep
	h := padY*2 + glyphH*scale + 28
	img := image.NewRGBA(image.Rect(0, 0, w, h))

	// Soft gradient-ish background (not flat white — hurts threshold OCR).
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			t := float64(x)/float64(w)*0.35 + float64(y)/float64(h)*0.25
			img.Set(x, y, color.RGBA{
				R: uint8(232 + int(t*14) + randInt(6)),
				G: uint8(236 + int(t*10) + randInt(6)),
				B: uint8(242 + int(t*8) + randInt(5)),
				A: 255,
			})
		}
	}

	// Speckles (OCR confusers) — moderate density so glyphs stay readable.
	for i := 0; i < w*h/14; i++ {
		x, y := randInt(w), randInt(h)
		img.Set(x, y, color.RGBA{
			R: uint8(120 + randInt(90)),
			G: uint8(130 + randInt(80)),
			B: uint8(150 + randInt(70)),
			A: uint8(70 + randInt(90)),
		})
	}

	// Interference under text.
	for i := 0; i < 3; i++ {
		c := color.RGBA{
			R: uint8(70 + randInt(80)),
			G: uint8(90 + randInt(70)),
			B: uint8(140 + randInt(70)),
			A: uint8(110 + randInt(60)),
		}
		drawWave(img, c, 1)
	}
	for i := 0; i < 5; i++ {
		c := color.RGBA{
			R: uint8(80 + randInt(100)),
			G: uint8(90 + randInt(90)),
			B: uint8(110 + randInt(90)),
			A: uint8(90 + randInt(70)),
		}
		drawLine(img, randInt(w), randInt(h), randInt(w), randInt(h), c)
	}

	palette := []color.RGBA{
		{R: 28, G: 70, B: 160, A: 255},
		{R: 20, G: 90, B: 140, A: 255},
		{R: 50, G: 40, B: 130, A: 255},
		{R: 15, G: 55, B: 110, A: 255},
	}

	x := padX
	for i := 0; i < len(code); i++ {
		ch := code[i]
		glyph, ok := captchaGlyphs[ch]
		if !ok {
			continue
		}
		ink := palette[randInt(len(palette))]
		dy := randInt(9) - 4
		rot := (float64(randInt(27)) - 13) * math.Pi / 180
		scl := scale
		if randInt(4) == 0 {
			scl = scale + 1
		}
		drawGlyphThick(img, x, padY+10+dy, glyph, scl, ink, rot)
		x += charStep + randInt(3) - 1
	}

	// Light interference after text (cuts strokes without burying them).
	for i := 0; i < 2; i++ {
		c := color.RGBA{
			R: uint8(60 + randInt(70)),
			G: uint8(80 + randInt(60)),
			B: uint8(120 + randInt(70)),
			A: uint8(120 + randInt(50)),
		}
		drawWave(img, c, 1)
	}

	// Mild sine warp — enough to break OCR segmentation, still human-readable.
	img = warpSine(img, 2.0+randFloat()*1.6, 0.035+randFloat()*0.02)

	// Light final salt (avoid heavy pepper that obliterates strokes).
	for i := 0; i < w*h/55; i++ {
		x, y := randInt(w), randInt(h)
		if randInt(3) == 0 {
			img.Set(x, y, color.RGBA{R: 255, G: 255, B: 255, A: 255})
		} else {
			img.Set(x, y, color.RGBA{R: 40, G: 55, B: 90, A: 140})
		}
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

func drawGlyphThick(img *image.RGBA, ox, oy int, glyph [7]string, scale int, c color.RGBA, rot float64) {
	cx := float64(ox + (5*scale)/2)
	cy := float64(oy + (7*scale)/2)
	cos, sin := math.Cos(rot), math.Sin(rot)
	for row := 0; row < 7; row++ {
		line := glyph[row]
		for col := 0; col < 5 && col < len(line); col++ {
			if line[col] != '1' {
				continue
			}
			for sy := 0; sy < scale; sy++ {
				for sx := 0; sx < scale; sx++ {
					// Slight hollow / irregular edges.
					if (sx == 0 || sy == 0 || sx == scale-1 || sy == scale-1) && randInt(5) == 0 {
						continue
					}
					px := float64(ox+col*scale+sx) - cx
					py := float64(oy+row*scale+sy) - cy
					rx := px*cos - py*sin + cx
					ry := px*sin + py*cos + cy
					xi, yi := int(math.Round(rx)), int(math.Round(ry))
					setSoft(img, xi, yi, c)
					// 1px thicken randomly.
					if randInt(3) == 0 {
						setSoft(img, xi+1, yi, c)
					}
					if randInt(4) == 0 {
						setSoft(img, xi, yi+1, c)
					}
				}
			}
		}
	}
}

func setSoft(img *image.RGBA, x, y int, c color.RGBA) {
	if !image.Pt(x, y).In(img.Bounds()) {
		return
	}
	img.Set(x, y, c)
}

func drawWave(img *image.RGBA, c color.RGBA, thickness int) {
	w := img.Bounds().Dx()
	h := img.Bounds().Dy()
	amp := 6.0 + randFloat()*10
	freq := 0.04 + randFloat()*0.08
	phase := randFloat() * math.Pi * 2
	baseY := float64(h)*0.25 + randFloat()*float64(h)*0.5
	for x := 0; x < w; x++ {
		y := int(baseY + math.Sin(float64(x)*freq+phase)*amp)
		for t := -thickness; t <= thickness; t++ {
			setSoft(img, x, y+t, c)
		}
	}
}

func warpSine(src *image.RGBA, amp, freq float64) *image.RGBA {
	b := src.Bounds()
	dst := image.NewRGBA(b)
	draw.Draw(dst, b, &image.Uniform{C: color.RGBA{R: 235, G: 238, B: 245, A: 255}}, image.Point{}, draw.Src)
	phase := randFloat() * math.Pi * 2
	phase2 := randFloat() * math.Pi * 2
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			sx := x + int(amp*math.Sin(float64(y)*freq+phase))
			sy := y + int((amp*0.55)*math.Sin(float64(x)*freq*1.3+phase2))
			if image.Pt(sx, sy).In(b) {
				dst.Set(x, y, src.At(sx, sy))
			}
		}
	}
	return dst
}

func drawLine(img *image.RGBA, x0, y0, x1, y1 int, c color.RGBA) {
	dx := abs(x1 - x0)
	dy := abs(y1 - y0)
	sx, sy := 1, 1
	if x0 > x1 {
		sx = -1
	}
	if y0 > y1 {
		sy = -1
	}
	err := dx - dy
	for {
		setSoft(img, x0, y0, c)
		if x0 == x1 && y0 == y1 {
			break
		}
		e2 := 2 * err
		if e2 > -dy {
			err -= dy
			x0 += sx
		}
		if e2 < dx {
			err += dx
			y0 += sy
		}
	}
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// MustRenderCaptchaPNG panics only in tests; handlers should use RenderCaptchaPNG.
func MustRenderCaptchaPNG(code string) string {
	u, err := RenderCaptchaPNG(code)
	if err != nil {
		panic(fmt.Sprintf("captcha png: %v", err))
	}
	return u
}
