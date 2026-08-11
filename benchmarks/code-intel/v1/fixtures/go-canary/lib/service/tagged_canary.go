//go:build canary

package service

func TaggedFeature() string {
	return BuildMessage()
}
